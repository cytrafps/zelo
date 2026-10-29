package transit

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

// RealtimeURL : GTFS-RT (trip_updates) de Grand Reims Mobilités, via transport.data.gouv.fr.
const RealtimeURL = "https://proxy.transport.data.gouv.fr/resource/fluo-citura-reims-gtfs-rt"

// RealtimeMaxAge : un flux plus vieux ne dit plus rien des véhicules en circulation.
const RealtimeMaxAge = 3 * time.Minute

// Realtime : heures prévues en temps réel, par course et par rang d'arrêt (stop_sequence).
type Realtime struct {
	At       time.Time
	times    map[string]map[int32][2]int64 // course → rang → (arrivée, départ) Unix, 0 si inconnu
	canceled map[string]bool
	// dates : jour de service de la mise à jour (start_date, « 20261103 ») quand le flux le donne.
	// Le même identifiant de course revient chaque jour : sans lui, un retard d'aujourd'hui
	// s'appliquerait aussi à la course de demain.
	dates map[string]string
}

// rtWindow : sans jour de service, une mise à jour vaut pour l'instance de la course dont l'horaire
// prévu est à moins de ça de l'heure annoncée.
const rtWindow = 6 * 3600

func FetchRealtime(ctx context.Context, client *http.Client, url string) (*Realtime, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gtfs-rt: HTTP %d", res.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	return ParseRealtime(b)
}

func ParseRealtime(b []byte) (*Realtime, error) {
	var f gtfs.FeedMessage
	if err := proto.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("gtfs-rt: %w", err)
	}
	rt := &Realtime{At: time.Unix(int64(f.GetHeader().GetTimestamp()), 0), times: map[string]map[int32][2]int64{}, canceled: map[string]bool{}, dates: map[string]string{}}
	for _, e := range f.Entity {
		tu := e.GetTripUpdate()
		if tu == nil || e.GetIsDeleted() {
			continue
		}
		id := tu.GetTrip().GetTripId()
		if d := tu.GetTrip().GetStartDate(); d != "" {
			rt.dates[id] = d
		}
		if tu.GetTrip().GetScheduleRelationship() == gtfs.TripDescriptor_CANCELED {
			rt.canceled[id] = true
			continue
		}
		stops := map[int32][2]int64{}
		for _, u := range tu.StopTimeUpdate {
			if u.StopSequence == nil || u.GetScheduleRelationship() == gtfs.TripUpdate_StopTimeUpdate_NO_DATA {
				continue
			}
			stops[int32(u.GetStopSequence())] = [2]int64{u.GetArrival().GetTime(), u.GetDeparture().GetTime()}
		}
		if len(stops) > 0 {
			rt.times[id] = stops
		}
	}
	return rt, nil
}

// Fresh : le flux est assez récent pour être appliqué à l'instant now.
func (rt *Realtime) Fresh(now time.Time) bool { return rt != nil && now.Sub(rt.At) < RealtimeMaxAge }

// effective : les connexions du jour avec les heures temps réel. Sans heure pour un arrêt, on
// garde le retard du dernier arrêt connu de la course (c'est l'usage GTFS-RT). Les courses
// supprimées disparaissent. Gardé en cache pour ce flux (rafraîchi toutes les 30 s).
func (t *Timetable) effective(day time.Time, rt *Realtime) ([]conn, []dayTrip, []int32) {
	conns, trips := t.connections(day)
	if rt == nil {
		return conns, trips, nil
	}
	key := day.Format("20060102")
	t.mu.Lock()
	if t.rtFor == rt && t.rtDay == key {
		c, d := t.rtConns, t.rtDelay
		t.mu.Unlock()
		return c, trips, d
	}
	t.mu.Unlock()

	// Retard au départ de chaque appel, par course du jour.
	type shift struct{ dep, arr []int64 }
	shifts := make([]*shift, len(trips))
	// Jour de service du flux, pour une suppression sans date : celui de l'heure du flux (une course
	// de 0 h 30 appartient encore au jour de service de la veille).
	feedDay := rt.At.In(Paris).Add(-4 * time.Hour).Format("20060102")
	for k, dt := range trips {
		tr := t.trips[dt.trip]
		date := time.Unix(dt.start+12*3600, 0).In(Paris).Format("20060102")
		rtDate, dated := rt.dates[tr.id]
		if dated && rtDate != date {
			continue // mise à jour d'un autre jour de service
		}
		if rt.canceled[tr.id] {
			if dated || date == feedDay {
				shifts[k] = &shift{} // vide : supprimée
			}
			continue
		}
		times, ok := rt.times[tr.id]
		if !ok {
			continue
		}
		if !dated && !nearInstance(tr, dt, times) {
			continue
		}
		s := &shift{dep: make([]int64, len(tr.calls)), arr: make([]int64, len(tr.calls))}
		var delay int64
		for i, c := range tr.calls {
			if x, ok := times[c.seq]; ok {
				if x[0] != 0 {
					delay = x[0] - (dt.start + int64(c.arr))
				}
				s.arr[i] = delay
				if x[1] != 0 {
					delay = x[1] - (dt.start + int64(c.dep))
				}
			} else {
				s.arr[i] = delay
			}
			s.dep[i] = delay
		}
		shifts[k] = s
	}
	out := make([]conn, 0, len(conns))
	delays := make([]int32, len(trips))
	for _, c := range conns {
		s := shifts[c.trip]
		if s == nil {
			out = append(out, c)
			continue
		}
		if s.dep == nil {
			continue // course supprimée
		}
		c.dep += s.dep[c.call]
		c.arr += s.arr[c.call+1]
		out = append(out, c)
		delays[c.trip] = 1 // marque : course suivie en temps réel
	}
	slices.SortFunc(out, func(a, b conn) int { return int(a.dep - b.dep) })
	t.mu.Lock()
	t.rtFor, t.rtDay, t.rtConns, t.rtDelay = rt, key, out, delays
	t.mu.Unlock()
	return out, trips, delays
}

// nearInstance : sans jour de service dans le flux, la mise à jour désigne l'instance de la course
// dont l'horaire prévu est proche de l'heure annoncée (premier arrêt renseigné).
func nearInstance(tr trip, dt dayTrip, times map[int32][2]int64) bool {
	for _, c := range tr.calls {
		x, ok := times[c.seq]
		if !ok {
			continue
		}
		at, planned := x[1], dt.start+int64(c.dep)
		if at == 0 {
			at, planned = x[0], dt.start+int64(c.arr)
		}
		if at == 0 {
			continue
		}
		d := at - planned
		return d > -rtWindow && d < rtWindow
	}
	return false
}
