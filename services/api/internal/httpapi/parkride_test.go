package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/store"
	"github.com/cytrafps/zelo/services/api/internal/transit"
)

// Vers la cathédrale un mardi à 8 h : P+R Neufchâtel puis tram jusqu'à Opéra-Cathédrale. Un
// parking ordinaire, et un P+R plus loin de l'origine que la destination, ne sont pas proposés.
func TestParkRide(t *testing.T) {
	b, err := os.ReadFile("../transit/testdata/citura-3-novembre.zip")
	if err != nil {
		t.Fatal(err)
	}
	tt, err := transit.Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeStore{parkings: []store.Parking{
		{ID: "way/neufchatel", Name: "P+R Neufchâtel", Lat: 49.2853, Lon: 4.0276, ParkRide: true},
		{ID: "way/debre", Name: "P+R Hôpital Debré", Lat: 49.2257, Lon: 4.0181, ParkRide: true},
		{ID: "way/erlon", Name: "Erlon", Lat: 49.2560, Lon: 4.0290},
	}}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := New(s, live.NewHub(0), quiet, Config{Transit: func() *transit.Timetable { return tt }})
	at := time.Date(2026, 11, 3, 8, 0, 0, 0, transit.Paris).Unix()
	// Départ au nord (Bétheny) : Hôpital Debré, au sud, n'est pas sur le chemin.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/park-ride?from=49.30,4.05&to=49.2538,4.0341&at="+itoa(at), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// Les clés que lit l'app (TransitStop) : en minuscules, json.Decode ne le vérifierait pas.
	if raw := rec.Body.String(); !strings.Contains(raw, `"from":{"id":`) || !strings.Contains(raw, `"name":"NEUFCHATEL"`) {
		t.Fatalf("arrêts sans les clés id/name : %.300s", raw)
	}
	var body struct {
		Options []struct {
			Parking  struct{ Name string }
			Journeys []struct {
				Legs                 []transit.Leg
				Arrive               time.Time
				BoardWalk, FinalWalk float64
			}
		}
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Options) != 1 || body.Options[0].Parking.Name != "P+R Neufchâtel" {
		t.Fatalf("%+v", body.Options)
	}
	js := body.Options[0].Journeys
	if len(js) < 3 {
		t.Fatalf("%d trajets", len(js))
	}
	first := js[0]
	if first.Legs[0].Line == nil || first.Legs[0].From.Name != "NEUFCHATEL" || first.Legs[0].Depart.Before(time.Unix(at, 0)) ||
		first.BoardWalk > 300 || first.FinalWalk > 800 || !first.Arrive.After(first.Legs[len(first.Legs)-1].Arrive) {
		t.Fatalf("premier trajet : %+v", first)
	}

	// Sans horaires chargés : aucune option, pas d'erreur.
	rec = httptest.NewRecorder()
	New(s, live.NewHub(0), quiet, Config{}).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/park-ride?to=49.2538,4.0341", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != `{"options":[]}`+"\n" {
		t.Fatalf("%d %q", rec.Code, rec.Body)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
