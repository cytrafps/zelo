package route

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

var gare, cathedrale = Point{49.2591, 4.0245}, Point{49.2535, 4.0341}

// Faux Valhalla : vérifie la requête envoyée et renvoie une réponse réelle enregistrée sur la Marne.
func fakeValhalla(t *testing.T, status int, body []byte) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/route" || r.Method != http.MethodPost {
			t.Errorf("requête inattendue %s %s", r.Method, r.URL.Path)
		}
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Directions.Language != "fr-FR" || len(req.Locations) != 2 || req.Locations[1].SearchCutoff != SearchCutoff || req.Alternates > MaxAlternates {
			t.Errorf("options manquantes : %+v", req)
		}
		w.WriteHeader(status)
		w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL)
}

func TestRouteGareCathedrale(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-cathedrale.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, 0)
	if err != nil || len(routes) != 1 {
		t.Fatal(routes, err)
	}
	r := routes[0]
	if r.Distance != 1875 || math.Round(r.Duration) != 449 {
		t.Errorf("distance %v m, durée %v s", r.Distance, r.Duration)
	}
	if len(r.Steps) != 13 || r.Steps[4].Instruction != "Tournez tout de suite à gauche dans Boulevard Général Leclerc." {
		t.Fatalf("étapes : %+v", r.Steps)
	}
	if r.Steps[0].Street != "Cour de la Gare" || r.Steps[0].Distance != 55 {
		t.Errorf("première étape : %+v", r.Steps[0])
	}
	// Le tracé part de la gare et arrive à la cathédrale (à quelques dizaines de mètres près).
	first, last := r.Coordinates[0], r.Coordinates[len(r.Coordinates)-1]
	if math.Abs(first[0]-gare.Lon) > 0.001 || math.Abs(first[1]-gare.Lat) > 0.001 ||
		math.Abs(last[0]-cathedrale.Lon) > 0.001 || math.Abs(last[1]-cathedrale.Lat) > 0.001 {
		t.Errorf("tracé de %v à %v", first, last)
	}
	if end := r.Steps[len(r.Steps)-1].Shape; end != len(r.Coordinates)-1 {
		t.Errorf("l'arrivée pointe sur %d, %d points", end, len(r.Coordinates))
	}
}

// Avec des alternatives : le meilleur d'abord, chacun avec son tracé et ses étapes.
func TestRoutesAlternatives(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-murigny-alternatives.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, Point{49.2475, 4.042}, Car, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 3 {
		t.Fatalf("%d itinéraires", len(routes))
	}
	for i, r := range routes {
		if len(r.Coordinates) < 2 || len(r.Steps) < 2 || r.Steps[len(r.Steps)-1].Shape != len(r.Coordinates)-1 {
			t.Errorf("itinéraire %d incomplet", i)
		}
		if i > 0 && r.Duration < routes[i-1].Duration {
			t.Errorf("non trié : %v puis %v", routes[i-1].Duration, r.Duration)
		}
	}
}

func TestRouteErreurs(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
		want   error
	}{
		"hors zone":    {400, `{"error_code":171,"error":"No suitable edges near location"}`, ErrOutOfArea},
		"non reliés":   {400, `{"error_code":442,"error":"No path could be found for input"}`, ErrNoRoute},
		"autre erreur": {500, `{"error_code":0,"error":"boom"}`, nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := fakeValhalla(t, tc.status, []byte(tc.body)).Routes(context.Background(), gare, cathedrale, Walk, 0)
			if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) {
				t.Errorf("erreur %v, attendu %v", err, tc.want)
			}
		})
	}
}

func TestDecodePolyline6(t *testing.T) {
	// Exemple de la documentation Valhalla, précision 6.
	pts, err := decodePolyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI")
	if err != nil {
		t.Fatal(err)
	}
	want := [][2]float64{{-120.2, 38.5}, {-120.95, 40.7}, {-126.453, 43.252}}
	if len(pts) != len(want) {
		t.Fatalf("%v", pts)
	}
	for i := range want {
		if math.Abs(pts[i][0]-want[i][0]) > 1e-9 || math.Abs(pts[i][1]-want[i][1]) > 1e-9 {
			t.Errorf("point %d : %v, attendu %v", i, pts[i], want[i])
		}
	}
	if _, err := decodePolyline6("_izlhA~rlgd"); err == nil {
		t.Error("tracé tronqué accepté")
	}
}
