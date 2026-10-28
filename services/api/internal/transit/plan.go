package transit

import (
	"math"
	"slices"
	"time"
)

const (
	// FootMax : deux stations à moins de cette distance (m) permettent une correspondance à pied.
	FootMax = 250.0
	// WalkSpeed : m/s, détours compris.
	WalkSpeed = 1.2
	// Change : marge pour changer de véhicule dans une même station (descendre, traverser, attendre).
	Change = 2 * time.Minute
	// MaxTransfers : au-delà, le trajet n'est pas proposé même s'il arrive plus tôt.
	MaxTransfers = 2
)

type footpath struct {
	to  int32
	sec int64
}

// conn : un véhicule va d'une station à la suivante (algorithme Connection Scan).
type conn struct {
	dep, arr int64 // heures Unix
	from, to int32
	trip     int32 // indice de la course dans la journée (unique par jour de service)
	call     int32 // rang de l'arrêt de départ dans la course
}

// Access : une station de départ ou d'arrivée et la marche (à vol d'oiseau, en temps) qui la relie.
type Access struct {
	Stop string
	Walk time.Duration
}

// Leg : un tronçon en véhicule, ou une correspondance à pied (Line vide).
type Leg struct {
	Line     *Line     `json:"line,omitempty"`
	Headsign string    `json:"headsign,omitempty"`
	From     Stop      `json:"from"`
	To       Stop      `json:"to"`
	Depart   time.Time `json:"depart"`
	Arrive   time.Time `json:"arrive"`
	Stops    int       `json:"stops,omitempty"` // arrêts parcourus
	// Realtime : heures données par le temps réel (sinon : horaires théoriques).
	Realtime bool `json:"realtime,omitempty"`
}

// Journey : de la station de montée à la station de descente.
type Journey struct {
	Legs []Leg `json:"legs"`
	// Arrive : à destination, marche finale comprise.
	Arrive time.Time `json:"arrive"`
}

func (t *Timetable) prepare() {
	t.index = make(map[string]int32, len(t.Stops))
	for i, s := range t.Stops {
		t.index[s.ID] = int32(i)
	}
	t.foot = make([][]footpath, len(t.Stops))
	for i, a := range t.Stops {
		for j, b := range t.Stops {
			if i == j {
				continue
			}
			if d := Distance(a.Lat, a.Lon, b.Lat, b.Lon); d <= FootMax {
				t.foot[i] = append(t.foot[i], footpath{int32(j), int64(math.Ceil(d / WalkSpeed))})
			}
		}
	}
	t.conns = map[string][]conn{}
}

// Distance (m) à vol d'oiseau, en projection locale.
func Distance(lat1, lon1, lat2, lon2 float64) float64 {
	const m = 111_320.0
	c := math.Cos((lat1 + lat2) / 2 * math.Pi / 180)
	return math.Hypot((lon2-lon1)*m*c, (lat2-lat1)*m)
}

type dayTrip struct {
	trip  int // indice dans t.trips
	start int64
}

// connections : toutes les connexions des jours de service day-1 à day+1, triées par départ, et
// les courses qu'elles référencent. Gardées en cache (quelques Mo par jour).
func (t *Timetable) connections(day time.Time) ([]conn, []dayTrip) {
	key := day.Format("20060102")
	t.mu.Lock()
	defer t.mu.Unlock()
	if c, ok := t.conns[key]; ok {
		return c, t.dayTrips(day)
	}
	var out []conn
	for k, dt := range t.dayTrips(day) {
		tr := t.trips[dt.trip]
		for i := 0; i+1 < len(tr.calls); i++ {
			a, b := tr.calls[i], tr.calls[i+1]
			out = append(out, conn{
				dep: dt.start + int64(a.dep), arr: dt.start + int64(b.arr),
				from: t.index[a.stop], to: t.index[b.stop], trip: int32(k), call: int32(i),
			})
		}
	}
	slices.SortFunc(out, func(a, b conn) int { return int(a.dep - b.dep) })
	if len(t.conns) > 4 {
		clear(t.conns) // les jours passés ne servent plus
	}
	t.conns[key] = out
	return out, t.dayTrips(day)
}

// dayTrips : courses qui circulent les jours de service day-1, day et day+1 (un trajet de nuit
// de la veille, ou une recherche tard le soir qui déborde sur le lendemain).
func (t *Timetable) dayTrips(day time.Time) []dayTrip {
	var out []dayTrip
	for d := -1; d <= 1; d++ {
		// Minuit du jour de service : midi moins 12 h (règle GTFS, juste les jours de changement d'heure).
		noon := time.Date(day.Year(), day.Month(), day.Day()+d, 12, 0, 0, 0, Paris)
		start := noon.Add(-12 * time.Hour).Unix()
		key := noon.Format("20060102")
		for i, tr := range t.trips {
			if t.days[tr.service][key] {
				out = append(out, dayTrip{i, start})
			}
		}
	}
	return out
}

// Plan : jusqu'à n trajets successifs des origines vers les cibles, partant entre after et
// after+within, du premier arrivé au dernier. Chaque trajet est le plus rapide pour son heure de
// départ (Connection Scan, arrivée au plus tôt) ; le suivant part strictement après lui.
// rt : temps réel à appliquer (nil, ou trop ancien : horaires théoriques).
func (t *Timetable) Plan(origins, targets []Access, after time.Time, within time.Duration, n int, rt *Realtime) []Journey {
	if !rt.Fresh(time.Now()) {
		rt = nil
	}
	conns, trips, live := t.effective(after.In(Paris), rt)
	limit := after.Add(within)
	var out []Journey
	for len(out) < n {
		j, ok := t.earliest(conns, trips, live, origins, targets, after)
		if !ok || j.Legs[0].Depart.After(limit) {
			break
		}
		out = append(out, j)
		// Le suivant : partir au moins une seconde après le premier départ de celui-ci.
		first := j.Legs[0].Depart
		for _, o := range origins {
			if o.Stop == j.Legs[0].From.ID {
				after = first.Add(-o.Walk).Add(time.Second)
			}
		}
	}
	return out
}

type label struct {
	at    int64
	enter int32 // connexion de montée (-1 : atteint à pied ou origine)
	exit  int32 // connexion de descente, ou station d'où l'on vient à pied (enter = -1)
	foot  bool
	rides int8
}

func (t *Timetable) earliest(conns []conn, trips []dayTrip, live []int32, origins, targets []Access, after time.Time) (Journey, bool) {
	const inf = math.MaxInt64
	best := make([]label, len(t.Stops))
	for i := range best {
		best[i] = label{at: inf, enter: -1, exit: -1}
	}
	start := after.Unix()
	for _, o := range origins {
		if i, ok := t.index[o.Stop]; ok {
			if at := start + int64(o.Walk.Seconds()); at < best[i].at {
				best[i] = label{at: at, enter: -1, exit: -1}
			}
		}
	}
	targetWalk := map[int32]int64{}
	for _, d := range targets {
		if i, ok := t.index[d.Stop]; ok {
			targetWalk[i] = int64(d.Walk.Seconds())
		}
	}
	bestArrive, bestStop := int64(inf), int32(-1)
	check := func(s int32) {
		if w, ok := targetWalk[s]; ok && best[s].at != inf && best[s].at+w < bestArrive && best[s].rides > 0 {
			bestArrive, bestStop = best[s].at+w, s
		}
	}
	entered := make([]int32, len(trips)) // connexion de montée de chaque course, +1 (0 : pas montés)
	rides := make([]int8, len(trips))
	k := sort(conns, start)
	for ; k < len(conns); k++ {
		c := conns[k]
		if c.dep >= bestArrive {
			break
		}
		if entered[c.trip] == 0 {
			l := best[c.from]
			margin := int64(0)
			if l.rides > 0 {
				margin = int64(Change.Seconds())
			}
			if l.at == inf || l.at+margin > c.dep || int(l.rides) > MaxTransfers {
				continue
			}
			entered[c.trip], rides[c.trip] = int32(k)+1, l.rides+1
		}
		if c.arr < best[c.to].at {
			best[c.to] = label{at: c.arr, enter: entered[c.trip] - 1, exit: int32(k), rides: rides[c.trip]}
			check(c.to)
			for _, f := range t.foot[c.to] {
				if at := c.arr + f.sec; at < best[f.to].at {
					best[f.to] = label{at: at, enter: -1, exit: c.to, foot: true, rides: rides[c.trip]}
					check(f.to)
				}
			}
		}
	}
	if bestStop < 0 {
		return Journey{}, false
	}
	// Remontée des étiquettes, de la station d'arrivée à l'origine.
	var legs []Leg
	for s := bestStop; ; {
		l := best[s]
		if l.foot {
			from := t.Stops[l.exit]
			legs = append(legs, Leg{From: from, To: t.Stops[s], Depart: time.Unix(best[l.exit].at, 0).In(Paris), Arrive: time.Unix(l.at, 0).In(Paris)})
			s = l.exit
			continue
		}
		if l.enter < 0 {
			break // origine
		}
		in, outC := conns[l.enter], conns[l.exit]
		tr := t.trips[trips[in.trip].trip]
		line := t.Lines[tr.line]
		legs = append(legs, Leg{
			Line: &line, Headsign: tr.headsign, From: t.Stops[in.from], To: t.Stops[outC.to],
			Depart: time.Unix(in.dep, 0).In(Paris), Arrive: time.Unix(outC.arr, 0).In(Paris), Stops: int(outC.call-in.call) + 1,
			Realtime: live != nil && live[in.trip] == 1,
		})
		s = in.from
	}
	slices.Reverse(legs)
	return Journey{Legs: legs, Arrive: time.Unix(bestArrive, 0).In(Paris)}, true
}

// sort : première connexion qui part à t ou après (recherche dichotomique).
func sort(conns []conn, t int64) int {
	i, _ := slices.BinarySearchFunc(conns, t, func(c conn, t int64) int {
		if c.dep < t {
			return -1
		}
		return 1
	})
	return i
}
