package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/store"
)

type fakeStore struct{ added []store.Report }

func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) FuelStations(context.Context, store.BBox, int) ([]store.FuelStation, error) {
	return nil, nil
}
func (f *fakeStore) ChargeStations(context.Context, store.BBox, int) ([]store.ChargeStation, error) {
	return nil, nil
}
func (f *fakeStore) Parkings(context.Context, store.BBox, int) ([]store.Parking, error) {
	return nil, nil
}
func (f *fakeStore) Reports(context.Context, store.BBox, int) ([]store.Report, error) {
	return f.added, nil
}
func (f *fakeStore) AddReport(_ context.Context, kind string, lat, lon float64, ttl time.Duration) (store.Report, error) {
	r := store.Report{ID: int64(len(f.added) + 1), Kind: kind, Lat: lat, Lon: lon, ExpiresAt: time.Now().Add(ttl)}
	f.added = append(f.added, r)
	return r, nil
}

func newTestAPI() (http.Handler, *fakeStore, *live.Hub) {
	s, hub := &fakeStore{}, live.NewHub()
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
	events, unsubscribe := hub.Subscribe()
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
