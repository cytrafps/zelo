package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/cytrafps/zelo/services/api/internal/junction"
	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/metrics"
	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/store"
)

// fakeStore imite la base, y compris la diffusion NOTIFY vers le hub.
type fakeStore struct {
	added     []store.Report
	reporters []string
	hub       *live.Hub
	controls  []junction.Control
	areas     []store.AreaOnRoute
	parkings  []store.Parking
}

func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) FuelStations(context.Context, store.BBox, int) ([]store.FuelStation, error) {
	return nil, nil
}
func (f *fakeStore) ChargeStations(context.Context, store.BBox, int) ([]store.ChargeStation, error) {
	return nil, nil
}
func (f *fakeStore) Parkings(context.Context, store.BBox, int) ([]store.Parking, error) {
	if f.parkings != nil {
		return f.parkings, nil
	}
	return []store.Parking{{ID: "way/31432939", Name: "Erlon"}, {ID: "way/1", Name: "Sans relevé"}}, nil
}
func (f *fakeStore) Controls(context.Context, [][2]float64, float64) ([]junction.Control, error) {
	return f.controls, nil
}
func (f *fakeStore) AreasAlong(context.Context, [][2]float64, float64) ([]store.AreaOnRoute, error) {
	return f.areas, nil
}
func (f *fakeStore) Reports(context.Context, store.BBox, int) ([]store.Report, error) {
	return f.added, nil
}
func (f *fakeStore) AddReport(_ context.Context, kind string, lat, lon float64, ttl time.Duration, voter string) (store.Report, bool, error) {
	r := store.Report{ID: int64(len(f.added) + 1), Kind: kind, Lat: lat, Lon: lon, ExpiresAt: time.Now().Add(ttl)}
	f.added = append(f.added, r)
	f.reporters = append(f.reporters, voter)
	msg, _ := json.Marshal(store.LiveEvent{Type: "report", Report: &r})
	f.hub.Broadcast(msg)
	return r, true, nil
}
func (f *fakeStore) Vote(_ context.Context, id int64, voter string, up bool, _ func(string) time.Duration) (store.Report, bool, error) {
	if id < 1 || int(id) > len(f.added) {
		return store.Report{}, false, store.ErrReportNotFound
	}
	if f.reporters[id-1] == voter {
		return store.Report{}, false, store.ErrOwnReport
	}
	r := f.added[id-1]
	if up {
		r.Confirmations++
	} else {
		r.Denials++
	}
	return r, false, nil
}

func newTestAPI() (http.Handler, *fakeStore, *live.Hub) {
	hub := live.NewHub(0)
	s := &fakeStore{hub: hub}
	return New(s, hub, slog.New(slog.NewTextHandler(io.Discard, nil)), Config{}), s, hub
}

func TestParseBBox(t *testing.T) {
	ok := []string{"3.98,49.22,4.08,49.28", " 3.98 , 49.22 , 4.08 , 49.28 "}
	bad := []string{"", "1,2,3", "4.08,49.22,3.98,49.28", "0,40,10,50", "a,b,c,d", "NaN,49,4,50"}
	for _, s := range ok {
		if _, err := parseBBox(s); err != nil {
			t.Errorf("parseBBox(%q) : %v", s, err)
		}
	}
	for _, s := range bad {
		if _, err := parseBBox(s); err == nil {
			t.Errorf("parseBBox(%q) aurait dû échouer", s)
		}
	}
}

func TestAddReportBroadcasts(t *testing.T) {
	h, s, hub := newTestAPI()
	events, unsubscribe, _ := hub.Subscribe()
	defer unsubscribe()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/reports",
		strings.NewReader(`{"kind":"accident","lat":49.25,"lon":4.03}`)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, corps = %s", rec.Code, rec.Body)
	}
	if len(s.added) != 1 || s.added[0].Kind != "accident" {
		t.Fatalf("signalement non enregistré : %+v", s.added)
	}
	select {
	case msg := <-events:
		var ev struct {
			Type   string       `json:"type"`
			Report store.Report `json:"report"`
		}
		if err := json.Unmarshal(msg, &ev); err != nil || ev.Type != "report" || ev.Report.Kind != "accident" {
			t.Fatalf("événement = %s (%v)", msg, err)
		}
	case <-time.After(time.Second):
		t.Fatal("aucun événement diffusé")
	}
}

func TestAddReportRejects(t *testing.T) {
	h, s, _ := newTestAPI()
	for _, body := range []string{
		`{"kind":"police","lat":49.25,"lon":4.03}`, // jamais de contrôles de police
		`{"kind":"radar","lat":49.25,"lon":4.03}`,
		`{"kind":"accident","lat":95,"lon":4.03}`,
		`{"kind":"accident","lat":49.25,"lon":4.03,"user":"x"}`,
		`pas du json`,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/reports", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s : code %d, want 400", body, rec.Code)
		}
	}
	if len(s.added) != 0 {
		t.Fatalf("aucun signalement ne devait passer : %+v", s.added)
	}
}

func TestRateLimit(t *testing.T) {
	h, _, _ := newTestAPI()
	codes := make([]int, 7)
	for i := range codes {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/reports",
			strings.NewReader(`{"kind":"bouchon","lat":49.25,"lon":4.03}`)))
		codes[i] = rec.Code
	}
	if codes[4] != http.StatusCreated || codes[5] != http.StatusTooManyRequests {
		t.Fatalf("codes = %v, want 5 × 201 puis 429", codes)
	}
}

func TestLivezIgnoresDatabase(t *testing.T) {
	h, _, _ := newTestAPI()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/livez", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
}

func post(h http.Handler, path, body string, device string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if device != "" {
		req.Header.Set("X-Zelo-Device", device)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestVote(t *testing.T) {
	h, _, _ := newTestAPI()
	const alice, bob = "alice-0123456789abcdef", "bob-0123456789abcdef"
	if rec := post(h, "/v1/reports", `{"kind":"accident","lat":49.25,"lon":4.03}`, alice); rec.Code != http.StatusCreated {
		t.Fatalf("création : %d", rec.Code)
	}
	cases := []struct {
		name, path, body, device string
		want                     int
	}{
		{"confirmation", "/v1/reports/1/votes", `{"up":true}`, bob, http.StatusOK},
		{"son propre signalement", "/v1/reports/1/votes", `{"up":false}`, alice, http.StatusConflict},
		{"inconnu", "/v1/reports/99/votes", `{"up":true}`, bob, http.StatusNotFound},
		{"id invalide", "/v1/reports/abc/votes", `{"up":true}`, bob, http.StatusNotFound},
		{"vote absent", "/v1/reports/1/votes", `{}`, bob, http.StatusBadRequest},
		{"champ inconnu", "/v1/reports/1/votes", `{"up":true,"x":1}`, bob, http.StatusBadRequest},
	}
	for _, c := range cases {
		if rec := post(h, c.path, c.body, c.device); rec.Code != c.want {
			t.Errorf("%s : code %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body)
		}
	}
}

// Sans identifiant d'appareil valide, le votant est identifié par son IP : on ne contourne pas
// la règle « pas de vote sur son propre signalement » en omettant l'en-tête.
func TestVoterFallsBackToIP(t *testing.T) {
	h, _, _ := newTestAPI()
	post(h, "/v1/reports", `{"kind":"travaux","lat":49.25,"lon":4.03}`, "")
	if rec := post(h, "/v1/reports/1/votes", `{"up":false}`, "court"); rec.Code != http.StatusConflict {
		t.Fatalf("code %d, want 409", rec.Code)
	}
}

type fakeRouter struct {
	err  error
	got  []route.Point
	mode route.Mode
	opts route.Options
}

func (f *fakeRouter) Routes(_ context.Context, from, to route.Point, mode route.Mode, opts route.Options) ([]route.Route, error) {
	f.got, f.mode, f.opts = []route.Point{from, to}, mode, opts
	return []route.Route{{Distance: 1875, Duration: 449, Coordinates: [][2]float64{{4.0245, 49.2591}, {4.0341, 49.2535}}}}, f.err
}

func TestRoute(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	call := func(cfg Config, query string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		New(&fakeStore{}, live.NewHub(0), quiet, cfg).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/route?"+query, nil))
		return rec
	}
	ok := "from=49.2591,4.0245&to=49.2535,4.0341&mode=car&alternates=2"

	if rec := call(Config{}, ok); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("sans Valhalla : %d", rec.Code)
	}

	r := &fakeRouter{}
	rec := call(Config{Router: r}, ok)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"routes":[{"distance":1875`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if r.mode != route.Car || r.opts.Alternates != 2 || r.got[0] != (route.Point{Lat: 49.2591, Lon: 4.0245}) {
		t.Errorf("relayé : %+v %v", r.got, r.mode)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("un itinéraire ne doit pas être mis en cache")
	}

	for _, q := range []string{"", "from=49.2,4.0&to=49.3,4.1", "from=49.2,4.0&to=49.3,4.1&mode=velo", "from=NaN,4&to=49.3,4.1&mode=walk", "from=95,4&to=49.3,4.1&mode=walk"} {
		if rec := call(Config{Router: r}, q); rec.Code != http.StatusBadRequest {
			t.Errorf("%q : %d", q, rec.Code)
		}
	}

	// Options : cap, heure de départ, évitements.
	depart := time.Now().Add(time.Hour).Truncate(time.Second)
	rec = call(Config{Router: r}, ok+"&heading=270.5&avoid=tolls,highways&depart="+strconv.FormatInt(depart.Unix(), 10))
	if rec.Code != http.StatusOK || r.opts.Heading == nil || *r.opts.Heading != 270.5 || !r.opts.AvoidTolls || !r.opts.AvoidHighways || !r.opts.Depart.Equal(depart) {
		t.Errorf("options : %d %+v", rec.Code, r.opts)
	}
	for _, bad := range []string{"&heading=361", "&heading=NaN", "&avoid=ferries", "&depart=12", "&depart=" + strconv.FormatInt(time.Now().Add(30*24*time.Hour).Unix(), 10)} {
		if rec := call(Config{Router: r}, ok+bad); rec.Code != http.StatusBadRequest {
			t.Errorf("%q : %d", bad, rec.Code)
		}
	}

	for err, code := range map[error]int{route.ErrOutOfArea: 422, route.ErrNoRoute: 422, errors.New("valhalla: timeout"): 502} {
		if rec := call(Config{Router: &fakeRouter{err: err}}, ok); rec.Code != code {
			t.Errorf("%v : %d, attendu %d", err, rec.Code, code)
		}
	}
}

func TestParkingsTariff(t *testing.T) {
	rec := httptest.NewRecorder()
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	New(&fakeStore{}, live.NewHub(0), quiet, Config{}).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/parkings?bbox=4,49,4.1,49.3", nil))
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, `"name":"Erlon"`) || !strings.Contains(body, `"tariff":{"free":30,"prices":[{"minutes":60,"cents":120}`) || !strings.Contains(body, `"name":"Sans relevé","operator":"","kind":"","lat":0,"lon":0,"capacity":null,"disabled":null,"charging":null,"fee":null,"maxHeight":null,"openingHours":"","parkRide":false,"tariff":null`) {
		t.Fatalf("%d %s", rec.Code, body)
	}
}

func TestMetrics(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := New(&fakeStore{}, live.NewHub(0), quiet, Config{Router: &fakeRouter{}})
	count := func(route, code string) float64 {
		return testutil.ToFloat64(metrics.HTTPRequests.WithLabelValues(route, code))
	}
	okBefore, unknownBefore := count("GET /v1/route", "200"), count("autre", "404")
	routesBefore := testutil.ToFloat64(metrics.Routes.WithLabelValues("car", "ok"))

	for _, path := range []string{"/v1/route?from=49.2591,4.0245&to=49.2535,4.0341&mode=car", "/wp-login.php"} {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
	}
	if count("GET /v1/route", "200") != okBefore+1 || count("autre", "404") != unknownBefore+1 {
		t.Errorf("requêtes : %v %v", count("GET /v1/route", "200"), count("autre", "404"))
	}
	if testutil.ToFloat64(metrics.Routes.WithLabelValues("car", "ok")) != routesBefore+1 {
		t.Error("itinéraire non compté")
	}
}

// Itinéraire en voiture : les manœuvres faites à un feu le disent ; à pied, rien n'est ajouté.
func TestRouteMarksTrafficLights(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := route.Route{
		Coordinates: [][2]float64{{4.0, 49.25}, {4.0013784, 49.25}, {4.0013784, 49.2508983}},
		Steps:       []route.Step{{Type: 1, Shape: 0}, {Type: 15, Shape: 1, Instruction: "Tournez à gauche."}, {Type: 4, Shape: 2}},
	}
	s := &fakeStore{controls: []junction.Control{{ID: "node/1", Kind: "feu", Lat: 49.25, Lon: 4.0012}}}
	for mode, want := range map[string]string{"car": "Au feu, tournez à gauche.", "walk": "Tournez à gauche."} {
		rec := httptest.NewRecorder()
		New(s, live.NewHub(0), quiet, Config{Router: fixedRouter{r}}).ServeHTTP(rec,
			httptest.NewRequest("GET", "/v1/route?from=49.25,4.0&to=49.2509,4.0014&mode="+mode, nil))
		var body struct{ Routes []route.Route }
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || rec.Code != http.StatusOK {
			t.Fatalf("%s : %d %v", mode, rec.Code, err)
		}
		if got := body.Routes[0].Steps[1].Instruction; got != want {
			t.Errorf("%s : %q, attendu %q", mode, got, want)
		}
	}
}

type fixedRouter struct{ r route.Route }

func (f fixedRouter) Routes(context.Context, route.Point, route.Point, route.Mode, route.Options) ([]route.Route, error) {
	r := f.r
	r.Steps = append([]route.Step(nil), f.r.Steps...) // chaque appel reçoit sa copie, comme de Valhalla
	return []route.Route{r}, nil
}

func TestToAreas(t *testing.T) {
	got := toAreas([]store.AreaOnRoute{
		{ID: "a", Fuel: map[string]float64{"Gazole": 1.8}, ChargeTotal: 4, ChargeFree: 2, ChargeKnown: 4},
		{ID: "b", ChargeTotal: 2},
		{ID: "c", Fuel: map[string]float64{}},
	})
	if got[0].Charge == nil || *got[0].Charge.Available != 2 || got[0].Fuel["Gazole"] != 1.8 {
		t.Errorf("a : %+v", got[0])
	}
	if got[1].Charge == nil || got[1].Charge.Available != nil {
		t.Errorf("b sans état publié : %+v", got[1].Charge)
	}
	if got[2].Charge != nil || got[2].Fuel != nil {
		t.Errorf("c sans station ni borne : %+v", got[2])
	}
}

// Moto et vélo : le bon mode part vers Valhalla ; les feux valent pour les deux.
func TestRouteModes(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	for q, want := range map[string]route.Mode{"moto": route.Motorcycle, "bike": route.Bicycle, "car": route.Car, "walk": route.Walk} {
		router := &fakeRouter{}
		rec := httptest.NewRecorder()
		New(&fakeStore{}, live.NewHub(0), quiet, Config{Router: router}).ServeHTTP(rec,
			httptest.NewRequest("GET", "/v1/route?from=49.2591,4.0245&to=49.2535,4.0341&mode="+q, nil))
		if rec.Code != http.StatusOK || router.mode != want {
			t.Errorf("mode=%s : %d, %q", q, rec.Code, router.mode)
		}
	}
}
