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
	walkSpeed       = 1.2    // m/s, détours compris
	ridesWindow     = 2 * time.Hour
	maxRides        = 8
)

type stopJSON struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Walk float64 `json:"walk"` // mètres à vol d'oiseau
}

type parkRideJSON struct {
	Parking parking        `json:"parking"`
	Board   stopJSON       `json:"board"`
	Alight  stopJSON       `json:"alight"`
	Line    transit.Line   `json:"line"`
	Rides   []transit.Ride `json:"rides"`
}

// parkRide : GET /v1/park-ride?to=lat,lon[&from=lat,lon][&at=<secondes Unix>]
// Parkings relais d'où un tram mène près de la destination, avec les prochains départs
// (à partir de at, l'heure où l'on y sera ; maintenant par défaut).
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
	parkings, err := a.store.Parkings(r.Context(), box, 2000)
	if err != nil {
		a.serverError(w, r, err)
		return
	}
	alights := nearStops(tt.Stops, to, stopToDest, 3)
	for _, p := range parkings {
		here := route.Point{Lat: p.Lat, Lon: p.Lon}
		if !p.ParkRide || dist(here, to) < parkRideMinGain || (from != nil && dist(*from, here) > dist(*from, to)) {
			continue
		}
		boards := nearStops(tt.Stops, here, parkRideToStop, 1)
		if len(boards) == 0 {
			continue
		}
		board := boards[0]
		best := parkRideJSON{}
		bestArrive := time.Time{}
		for _, alight := range alights {
			if alight.ID == board.ID {
				continue
			}
			rides := tt.Rides(board.ID, alight.ID, at.Add(seconds(board.Walk/walkSpeed)), ridesWindow)
			if len(rides) == 0 {
				continue
			}
			arrive := rides[0].Arrive.Add(seconds(alight.Walk / walkSpeed))
			if bestArrive.IsZero() || arrive.Before(bestArrive) {
				best = parkRideJSON{Parking: parking{p, tarif.For(p.ID)}, Board: board, Alight: alight, Line: tt.Lines[rides[0].LineID], Rides: rides[:min(len(rides), maxRides)]}
				bestArrive = arrive
			}
		}
		if !bestArrive.IsZero() {
			options = append(options, best)
		}
	}
	slices.SortFunc(options, func(x, y parkRideJSON) int {
		return x.Rides[0].Arrive.Add(seconds(x.Alight.Walk / walkSpeed)).Compare(y.Rides[0].Arrive.Add(seconds(y.Alight.Walk / walkSpeed)))
	})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"options": options})
}

// nearStops : au plus n arrêts à moins de max mètres de p, du plus proche au plus loin.
func nearStops(stops []transit.Stop, p route.Point, max float64, n int) []stopJSON {
	var out []stopJSON
	for _, s := range stops {
		if d := dist(p, route.Point{Lat: s.Lat, Lon: s.Lon}); d <= max {
			out = append(out, stopJSON{ID: s.ID, Name: s.Name, Lat: s.Lat, Lon: s.Lon, Walk: math.Round(d)})
		}
	}
	slices.SortFunc(out, func(a, b stopJSON) int { return cmp.Compare(a.Walk, b.Walk) })
	return out[:min(len(out), n)]
}

func dist(a, b route.Point) float64 {
	const m = 111_320.0
	c := math.Cos((a.Lat + b.Lat) / 2 * math.Pi / 180)
	return math.Hypot((b.Lon-a.Lon)*m*c, (b.Lat-a.Lat)*m)
}

func seconds(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }
