package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/zfe"
)

func TestZFE(t *testing.T) {
	square := [][][][2]float64{{{{4.0, 49.24}, {4.05, 49.24}, {4.05, 49.27}, {4.0, 49.27}, {4.0, 49.24}}}}
	zones := []zfe.Zone{
		{ID: "en-vigueur", From: "2023-01-01", To: "2099-12-31", Car: &zfe.Rule{Banned: "V4", Hours: "24/7"}, Rings: square},
		{ID: "finie", From: "2022-01-01", To: "2022-12-31", Rings: square},
		{ID: "ailleurs", From: "2023-01-01", Rings: [][][][2]float64{{{{2.3, 48.8}, {2.4, 48.8}, {2.4, 48.9}, {2.3, 48.8}}}}},
	}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := New(&fakeStore{}, live.NewHub(0), quiet, Config{Zones: func() []zfe.Zone { return zones }})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/zfe?bbox=3.9,49.2,4.1,49.3", nil))
	var body struct{ Items []zfe.Zone }
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || len(body.Items) != 1 || body.Items[0].ID != "en-vigueur" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/zfe", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("sans bbox : %d", rec.Code)
	}
}
