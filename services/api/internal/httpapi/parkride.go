package httpapi

import (
	"cmp"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/store"
	"github.com/cytrafps/zelo/services/api/internal/tarif"
	"github.com/cytrafps/zelo/services/api/internal/transit"
)

const (
	// Du parking relais au quai, et du quai d'arrivée à la destination (à vol d'oiseau).
	parkRideToStop  = 300.0
	stopToDest      = 800.0
	parkRideMinGain = 1500.0 // plus près, autant se garer à destination
	ridesWindow     = 2 * time.Hour
	maxRides        = 6
)

type journeyJSON struct {
	transit.Journey
	// BoardWalk, FinalWalk : mètres à vol d'oiseau du parking au premier arrêt, et du dernier à la destination.
	BoardWalk float64 `json:"boardWalk"`
	FinalWalk float64 `json:"finalWalk"`
}

type parkRideJSON struct {
	Parking  parking       `json:"parking"`
	Journeys []journeyJSON `json:"journeys"`
}

// parkRide : GET /v1/park-ride?to=lat,lon[&from=lat,lon][&at=<secondes Unix>]
// Parkings relais d'où le tram ou le bus (correspondances comprises) mène près de la destination,
// avec les prochains départs (à partir de at, l'heure où l'on y sera ; maintenant par défaut).
func (a *API) parkRide(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	to, err := parsePoint(q.Get("to"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "attendu : to=lat,lon[&from=lat,lon][&at=…]")
		return
	}
	var from *route.Point
	if s := q.Get("from"); s != "" {
		p, err := parsePoint(s)
		if err != nil {
			httpError(w, http.StatusBadRequest, "from invalide")
			return
		}
		from = &p
	}
	at := time.Now()
	if s := q.Get("at"); s != "" {
		sec, err := strconv.ParseInt(s, 10, 64)
		if err != nil || time.Unix(sec, 0).Before(at.Add(-time.Hour)) || time.Unix(sec, 0).After(at.Add(7*24*time.Hour)) {
			httpError(w, http.StatusBadRequest, "at : heure Unix, d'il y a une heure à dans 7 jours")
			return
		}
		at = time.Unix(sec, 0)
	}
	options := []parkRideJSON{}
	var tt *transit.Timetable
	if a.cfg.Transit != nil {
		tt = a.cfg.Transit()
	}
	if tt == nil {
		writeJSON(w, http.StatusOK, map[string]any{"options": options})
		return
	}
	// Parkings relais à 15 km au plus.
	box := store.BBox{MinLon: to.Lon - 0.2, MinLat: to.Lat - 0.14, MaxLon: to.Lon + 0.2, MaxLat: to.Lat + 0.14}
	parkings, err := a.store.Parkings(r.Context(), box, 2000, "car")
	if err != nil {
		a.serverError(w, r, err)
		return
	}
	targets, targetDist := access(tt.Stops, to, stopToDest, 8)
	for _, p := range parkings {
		here := route.Point{Lat: p.Lat, Lon: p.Lon}
		if !p.ParkRide || dist(here, to) < parkRideMinGain || (from != nil && dist(*from, here) > dist(*from, to)) {
			continue
		}
		origins, originDist := access(tt.Stops, here, parkRideToStop, 3)
		if len(origins) == 0 {
			continue
		}
		var js []journeyJSON
		var rt *transit.Realtime
		if a.cfg.Realtime != nil {
			rt = a.cfg.Realtime()
		}
		for _, j := range tt.Plan(origins, targets, at, ridesWindow, maxRides, rt) {
			js = append(js, journeyJSON{Journey: j, BoardWalk: originDist[j.Legs[0].From.ID], FinalWalk: targetDist[j.Legs[len(j.Legs)-1].To.ID]})
		}
		if len(js) > 0 {
			options = append(options, parkRideJSON{Parking: parking{p, tarif.For(p.ID)}, Journeys: js})
		}
	}
	slices.SortFunc(options, func(x, y parkRideJSON) int { return x.Journeys[0].Arrive.Compare(y.Journeys[0].Arrive) })
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"options": options})
}

// access : au plus n stations à moins de max mètres de p, avec le temps de marche, et leur distance.
func access(stops []transit.Stop, p route.Point, max float64, n int) ([]transit.Access, map[string]float64) {
	type near struct {
		id string
		d  float64
	}
	var all []near
	for _, s := range stops {
		if d := dist(p, route.Point{Lat: s.Lat, Lon: s.Lon}); d <= max {
			all = append(all, near{s.ID, d})
		}
	}
	slices.SortFunc(all, func(a, b near) int { return cmp.Compare(a.d, b.d) })
	all = all[:min(len(all), n)]
	out := make([]transit.Access, len(all))
	dists := make(map[string]float64, len(all))
	for i, x := range all {
		out[i] = transit.Access{Stop: x.id, Walk: seconds(x.d / transit.WalkSpeed)}
		dists[x.id] = math.Round(x.d)
	}
	return out, dists
}

func dist(a, b route.Point) float64 { return transit.Distance(a.Lat, a.Lon, b.Lat, b.Lon) }

func seconds(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }
