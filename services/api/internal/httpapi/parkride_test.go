package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/store"
	"github.com/cytrafps/zelo/services/api/internal/transit"
)

// Vers la cathédrale un mardi à 8 h : P+R Neufchâtel puis tram jusqu'à Opéra-Cathédrale. Un
// parking ordinaire, et un P+R plus loin de l'origine que la destination, ne sont pas proposés.
func TestParkRide(t *testing.T) {
	b, err := os.ReadFile("../transit/testdata/citura-tram.zip")
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
	var body struct {
		Options []struct {
			Parking struct{ Name string }
			Board   struct{ Name string }
			Alight  struct {
				Name string
				Walk float64
			}
			Line  struct{ Name, Color string }
			Rides []transit.Ride
		}
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Options) != 1 {
		t.Fatalf("%d options : %+v", len(body.Options), body.Options)
	}
	o := body.Options[0]
	if o.Parking.Name != "P+R Neufchâtel" || o.Board.Name != "NEUFCHATEL" || o.Alight.Name != "OPERA-CATHEDRALE" || o.Line.Color != "E0001B" {
		t.Fatalf("%+v", o)
	}
	if len(o.Rides) < 3 || o.Rides[0].Depart.Before(time.Unix(at, 0)) || o.Alight.Walk > 800 {
		t.Fatalf("départs : %+v", o.Rides)
	}

	// Sans horaires chargés : aucune option, pas d'erreur.
	rec = httptest.NewRecorder()
	New(s, live.NewHub(0), quiet, Config{}).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/park-ride?to=49.2538,4.0341", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != `{"options":[]}`+"\n" {
		t.Fatalf("%d %q", rec.Code, rec.Body)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
