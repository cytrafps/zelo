package httpapi

import (
	"cmp"
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/store"
)

// Autour du trajet, les fermetures qui peuvent le concerner (degrés, ~3 km).
const corridorMargin = 0.03

// Valhalla refuse une requête dont les zones exclues dépassent, en tout, 2 000 sommets ou
// 100 km de périmètre (services/valhalla/data/valhalla.json) : on reste en deçà.
const (
	maxExcludeVertices = 1500
	maxExcludeMeters   = 80_000
)

// closedRadius (m) : demi-côté de la zone exclue autour d'une route fermée signalée.
const closedRadius = 12.0

// exclusions : rues à contourner pour un départ à `at` — fermetures publiées dans DiaLog qui
// s'appliquent à ce moment, et routes fermées signalées (et pas plus infirmées que confirmées).
// À pied, rien : une rue fermée aux voitures reste ouverte aux piétons.
func (a *API) exclusions(ctx context.Context, from, to route.Point, mode route.Mode, at time.Time) [][][2]float64 {
	if mode == route.Walk {
		return nil
	}
	box := store.BBox{
		MinLon: min(from.Lon, to.Lon) - corridorMargin*1.5, MinLat: min(from.Lat, to.Lat) - corridorMargin,
		MaxLon: max(from.Lon, to.Lon) + corridorMargin*1.5, MaxLat: max(from.Lat, to.Lat) + corridorMargin,
	}
	in := func(p [2]float64) bool {
		return p[0] >= box.MinLon && p[0] <= box.MaxLon && p[1] >= box.MinLat && p[1] <= box.MaxLat
	}
	var out [][][2]float64
	vertices, meters := 0, 0.0
	add := func(ring [][2]float64) {
		m := route.Perimeter(ring)
		if ring == nil || vertices+len(ring) > maxExcludeVertices || meters+m > maxExcludeMeters {
			return
		}
		vertices, meters = vertices+len(ring), meters+m
		out = append(out, ring)
	}
	if a.cfg.Closures != nil {
		for _, c := range a.cfg.Closures() {
			if !c.Active(at) {
				continue
			}
			for _, l := range c.Lines {
				if touches(l, in) {
					add(route.Along(l, route.ClosureWidth))
				}
			}
		}
	}
	reports, err := a.store.Reports(ctx, box, 200)
	if err != nil {
		a.log.Warn("routes fermées signalées", "err", err)
		return out
	}
	for _, r := range reports {
		if r.Kind == "route_fermee" && r.Confirmations >= r.Denials {
			add(route.Around(route.Point{Lat: r.Lat, Lon: r.Lon}, closedRadius))
		}
	}
	return out
}

func touches(l [][2]float64, in func([2]float64) bool) bool {
	for _, p := range l {
		if in(p) {
			return true
		}
	}
	return false
}

// closureView : une fermeture publiée dans DiaLog, telle que la sert /v1/closures.
type closureView struct {
	ID   string     `json:"id"`
	Name string     `json:"name"`
	URL  string     `json:"url"`
	From *time.Time `json:"from"` // null : depuis toujours
	To   *time.Time `json:"to"`   // null : sans fin
	// Periodic : la fermeture ne s'applique qu'à certains créneaux (rue piétonne le week-end…).
	Periodic bool           `json:"periodic"`
	Active   bool           `json:"active"` // elle s'applique en ce moment
	Lines    [][][2]float64 `json:"lines"`  // [lon, lat]
}

// closures : GET /v1/closures?bbox=… — fermetures DiaLog de la zone qui ne sont pas terminées,
// en cours d'abord, puis par date de début.
func (a *API) closures(w http.ResponseWriter, r *http.Request) {
	b, err := parseBBox(r.URL.Query().Get("bbox"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	in := func(p [2]float64) bool {
		return p[0] >= b.MinLon && p[0] <= b.MaxLon && p[1] >= b.MinLat && p[1] <= b.MaxLat
	}
	now := time.Now()
	items := []closureView{}
	if a.cfg.Closures != nil {
		for _, c := range a.cfg.Closures() {
			if !c.To.IsZero() && !now.Before(c.To) {
				continue
			}
			inside := false
			for _, l := range c.Lines {
				inside = inside || touches(l, in)
			}
			if !inside {
				continue
			}
			v := closureView{ID: c.ID, Name: c.Name, URL: c.URL, Periodic: len(c.Periods) > 0, Active: c.Active(now), Lines: c.Lines}
			if !c.From.IsZero() {
				v.From = &c.From
			}
			if !c.To.IsZero() {
				v.To = &c.To
			}
			items = append(items, v)
		}
	}
	slices.SortStableFunc(items, func(x, y closureView) int {
		if x.Active != y.Active {
			if x.Active {
				return -1
			}
			return 1
		}
		return cmp.Compare(unix(x.From), unix(y.From))
	})
	w.Header().Set("Cache-Control", "public, max-age=600")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func unix(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.Unix()
}
