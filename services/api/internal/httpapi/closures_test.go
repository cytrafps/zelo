package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/closure"
	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/store"
)

// Valhalla qui ne trouve pas de chemin tant qu'une zone est exclue (arrivée dans la rue fermée).
type blockedRouter struct{ calls []route.Options }

func (b *blockedRouter) Routes(_ context.Context, _, _ route.Point, _ route.Mode, o route.Options) ([]route.Route, error) {
	b.calls = append(b.calls, o)
	if len(o.Exclude) > 0 {
		return nil, route.ErrNoRoute
	}
	return []route.Route{{Coordinates: [][2]float64{{4.0245, 49.2591}, {4.0341, 49.2535}}}}, nil
}

func TestRouteClosures(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	buirette := closure.Closure{Name: "Rue Buirette", Lines: [][][2]float64{{{4.0272, 49.2571}, {4.0300, 49.2560}}}}
	ended := closure.Closure{Name: "Travaux finis", To: time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC), Lines: buirette.Lines}
	far := closure.Closure{Name: "Paris", Lines: [][][2]float64{{{2.37, 48.86}, {2.38, 48.86}}}}
	fs := &fakeStore{added: []store.Report{
		{Kind: "route_fermee", Lat: 49.256, Lon: 4.03, Confirmations: 1},
		{Kind: "route_fermee", Lat: 49.257, Lon: 4.03, Denials: 2}, // infirmée
		{Kind: "bouchon", Lat: 49.258, Lon: 4.03},
	}}
	call := func(r Router, mode string) int {
		rec := httptest.NewRecorder()
		cfg := Config{Router: r, Closures: func() []closure.Closure { return []closure.Closure{buirette, ended, far} }}
		New(fs, live.NewHub(0), quiet, cfg).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/route?from=49.2591,4.0245&to=49.2535,4.0341&mode="+mode, nil))
		return rec.Code
	}

	r := &fakeRouter{}
	if code := call(r, "car"); code != http.StatusOK {
		t.Fatal(code)
	}
	// La rue Buirette (en vigueur, sur le secteur) et la route fermée confirmée : deux zones.
	if len(r.opts.Exclude) != 2 {
		t.Errorf("%d zones exclues, attendu 2", len(r.opts.Exclude))
	}
	if call(r, "walk"); len(r.opts.Exclude) != 0 {
		t.Error("à pied, une rue fermée aux voitures reste ouverte")
	}

	b := &blockedRouter{}
	if code := call(b, "car"); code != http.StatusOK || len(b.calls) != 2 || len(b.calls[1].Exclude) != 0 {
		t.Errorf("sans chemin qui évite la fermeture : nouvel essai sans elle attendu (%d, %d appels)", code, len(b.calls))
	}
}
