package route

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
	"github.com/cytrafps/zelo/services/api/internal/servicearea"
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
		if req.Format != "osrm" || req.Directions.Language != "fr-FR" || len(req.Locations) != 2 || req.Locations[1].SearchCutoff != SearchCutoff || req.Alternates > MaxAlternates {
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
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
	if err != nil || len(routes) != 1 {
		t.Fatal(routes, err)
	}
	r := routes[0]
	if math.Round(r.Distance) != 2588 || math.Round(r.Duration) != 500 {
		t.Errorf("distance %v m, durée %v s", r.Distance, r.Duration)
	}
	if len(r.Steps) != 9 || r.Steps[1].Instruction != "Tournez à droite dans Boulevard Joffre." || r.Steps[1].Type != 10 {
		t.Fatalf("étapes : %+v", r.Steps)
	}
	if r.Steps[0].Street != "Cour de la Gare" || r.Steps[0].Type != 1 || math.Round(r.Steps[0].Distance) != 52 {
		t.Errorf("première étape : %+v", r.Steps[0])
	}
	// Types Valhalla retrouvés depuis OSRM : demi-tour, rond-point (entrée, sortie), arrivée à droite.
	if got := []int{r.Steps[2].Type, r.Steps[5].Type, r.Steps[6].Type, r.Steps[8].Type}; !slices.Equal(got, []int{13, 26, 27, 5}) {
		t.Errorf("types : %v", got)
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
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, Point{49.2475, 4.042}, Car, Options{Alternates: 5})
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
		"hors zone":    {400, `{"code":"NoSegment","message":"One of the supplied input coordinates could not snap to street segment."}`, ErrOutOfArea},
		"non reliés":   {400, `{"code":"NoRoute","message":"Impossible route between points"}`, ErrNoRoute},
		"autre erreur": {500, `{"code":"InvalidValue","message":"boom"}`, nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := fakeValhalla(t, tc.status, []byte(tc.body)).Routes(context.Background(), gare, cathedrale, Walk, Options{})
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

func TestRouteOptions(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"code":"Ok","routes":[{"distance":1000,"duration":60,"geometry":"","legs":[{"steps":[]}]}]}`))
	}))
	t.Cleanup(srv.Close)
	h := 92.5
	// 7 h 30 UTC un 28 octobre : 8 h 30 à Reims (heure d'hiver).
	depart := time.Date(2026, 10, 28, 7, 30, 0, 0, time.UTC)
	if _, err := New(srv.URL).Routes(context.Background(), gare, cathedrale, Car, Options{Heading: &h, Depart: depart, AvoidTolls: true}); err != nil {
		t.Fatal(err)
	}
	start := got["locations"].([]any)[0].(map[string]any)
	if start["heading"] != 92.5 || start["heading_tolerance"] != float64(HeadingTolerance) {
		t.Errorf("départ : %v", start)
	}
	if _, ok := got["locations"].([]any)[1].(map[string]any)["heading"]; ok {
		t.Error("le cap ne concerne que le départ")
	}
	if dt := got["date_time"].(map[string]any); dt["type"] != 1.0 || dt["value"] != "2026-10-28T08:30" {
		t.Errorf("date_time : %v", dt)
	}
	auto := got["costing_options"].(map[string]any)["auto"].(map[string]any)
	if auto["use_tolls"] != 0.0 || auto["use_highways"] != nil {
		t.Errorf("costing_options : %v", auto)
	}

	// Sans option : requête inchangée.
	if _, err := New(srv.URL).Routes(context.Background(), gare, cathedrale, Walk, Options{AvoidTolls: true}); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"date_time", "costing_options"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s envoyé sans raison", k)
		}
	}
}

// Feux et stops relevés dans OSM autour du trajet gare → Saint-Rémi : trois manœuvres s'y font.
func TestAnnotateControls(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-saint-remi.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var controls []Control
	raw, _ := os.ReadFile("testdata/controles-saint-remi.json")
	if err := json.Unmarshal(raw, &controls); err != nil {
		t.Fatal(err)
	}
	r := routes[0]
	Annotate(&r, controls)
	got := map[int]string{}
	for i, s := range r.Steps {
		if s.Control != "" {
			got[i] = s.Control
		}
		if (s.Type == 26 || s.Type == 27) && s.Control != "" {
			t.Errorf("rond-point annoté : %+v", s)
		}
	}
	if want := map[int]string{2: "feu", 8: "feu", 11: "stop"}; !maps.Equal(got, want) {
		t.Fatalf("contrôles %v, attendu %v", got, want)
	}
	if s := r.Steps[2].Instruction; s != "Au feu, tournez à droite dans Boulevard Louis Roederer." {
		t.Errorf("consigne : %q", s)
	}
	if s := r.Steps[11].Instruction; s != "Au stop, tournez à droite dans Rue Damide." {
		t.Errorf("consigne : %q", s)
	}
}

// Un feu du sens inverse, posé juste après le carrefour sur la rue où l'on s'engage, est ignoré.
func TestAnnotateIgnoresOppositeSignal(t *testing.T) {
	// Tout droit vers l'est 100 m, puis à gauche vers le nord 100 m : virage au point 1.
	r := Route{
		Coordinates: [][2]float64{{4.0, 49.25}, {4.0013784, 49.25}, {4.0013784, 49.2508983}},
		Steps:       []Step{{Type: 1, Shape: 0}, {Type: 15, Shape: 1, Instruction: "Tournez à gauche."}, {Type: 4, Shape: 2}},
	}
	after := Control{Kind: "feu", Lat: 49.2501797, Lon: 4.0013784} // 20 m après le virage
	Annotate(&r, []Control{after})
	if r.Steps[1].Control != "" {
		t.Fatalf("feu du sens inverse retenu : %+v", r.Steps[1])
	}
	before := Control{Kind: "feu", Lat: 49.25, Lon: 4.0012} // 12 m avant
	Annotate(&r, []Control{before})
	if r.Steps[1].Control != "feu" || r.Steps[1].Instruction != "Au feu, tournez à gauche." {
		t.Fatalf("feu d'approche ignoré : %+v", r.Steps[1])
	}
}

func TestApproachLanes(t *testing.T) {
	pts := [][2]float64{{4.0, 49.25}, {4.0006, 49.25}, {4.0012, 49.25}} // ~44 m entre points
	step := func(modifier string, lanes ...[]osrmLane) osrmStep {
		var s osrmStep
		s.Maneuver.Modifier = modifier
		for i, l := range lanes {
			s.Intersections = append(s.Intersections, osrmIntersection{GeometryIndex: i, Lanes: l})
		}
		return s
	}
	left := []osrmLane{{Indications: []string{"left"}, Valid: true, Active: true}, {Indications: []string{"straight", "right"}, Valid: false}}
	straight := []osrmLane{{Indications: []string{"straight"}, Valid: true, Active: true}, {Indications: []string{"straight", "right"}, Valid: true}}

	// Voies décrites au carrefour précédent (44 m avant), qui mènent au virage à gauche.
	prev, turn := step("", nil, left), step("left")
	turn.Intersections = append(turn.Intersections, osrmIntersection{GeometryIndex: 2})
	if got := approachLanes(prev, turn, pts); len(got) != 2 || !got[0].Take || got[1].Take {
		t.Errorf("virage à gauche : %+v", got)
	}
	// Voies « tout droit » d'un carrefour intermédiaire : sans rapport avec le virage, rien à montrer.
	if got := approachLanes(step("", nil, straight), turn, pts); got != nil {
		t.Errorf("voies hors sujet : %+v", got)
	}
}

func TestManeuverType(t *testing.T) {
	cases := []struct {
		kind, modifier string
		want           int
	}{
		{"depart", "", 1}, {"turn", "right", 10}, {"turn", "sharp left", 14}, {"end of road", "left", 15},
		{"continue", "uturn", 13}, {"new name", "straight", 8}, {"off ramp", "slight right", 20},
		{"on ramp", "slight left", 19}, {"fork", "slight right", 23}, {"merge", "slight left", 38},
		{"rotary", "right", 26}, {"exit roundabout", "slight right", 27}, {"arrive", "left", 6},
	}
	for _, c := range cases {
		if got := maneuverType(c.kind, c.modifier); got != c.want {
			t.Errorf("%s %s : %d, attendu %d", c.kind, c.modifier, got, c.want)
		}
	}
}

// Aires de l'A4 entre Reims et Châlons : chaque sens n'a que les aires de son côté
// (Reims Champagne-Sud vers Châlons, -Nord vers Reims ; l'Espérance et la Vesle se font face).
func TestPlaceAreas(t *testing.T) {
	f, err := os.Open("../servicearea/testdata/marne.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	els, err := overpass.Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	var candidates []Area
	for _, a := range servicearea.FromElements(els) {
		candidates = append(candidates, Area{ID: a.ID, Name: a.Name, Lat: a.Lat, Lon: a.Lon})
	}
	cases := map[string][]string{
		"reims-chalons": {"Aire de l'Espérance", "Aire de Reims Champagne-Sud"},
		"chalons-reims": {"Aire des Grands Traquiers", "Aire de Reims Champagne-Nord", "Aire de la Vesle"},
	}
	for fixture, want := range cases {
		body, err := os.ReadFile("testdata/" + fixture + ".json")
		if err != nil {
			t.Fatal(err)
		}
		routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
		if err != nil {
			t.Fatal(err)
		}
		r := routes[0]
		PlaceAreas(&r, candidates)
		var got []string
		for i, a := range r.Areas {
			got = append(got, a.Name)
			if i > 0 && a.Along < r.Areas[i-1].Along {
				t.Errorf("%s : aires dans le désordre", fixture)
			}
		}
		if !slices.Equal(got, want) {
			t.Errorf("%s : %v, attendu %v", fixture, got, want)
		}
	}
}

func TestMotorcycleAvoidsHighways(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"code":"Ok","routes":[{"distance":1000,"duration":60,"geometry":"","legs":[{"steps":[]}]}]}`))
	}))
	t.Cleanup(srv.Close)
	if _, err := New(srv.URL).Routes(context.Background(), gare, cathedrale, Motorcycle, Options{AvoidHighways: true}); err != nil {
		t.Fatal(err)
	}
	moto, ok := got["costing_options"].(map[string]any)["motorcycle"].(map[string]any)
	if got["costing"] != "motorcycle" || !ok || moto["use_highways"] != 0.0 {
		t.Fatalf("requête : %v", got)
	}
}

// Un cédez-le-passage annonce la manœuvre, sauf là où un feu ou un stop la règle déjà.
func TestAnnotateGiveWay(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-saint-remi.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var controls []Control
	raw, _ := os.ReadFile("testdata/controles-saint-remi.json")
	if err := json.Unmarshal(raw, &controls); err != nil {
		t.Fatal(err)
	}
	r := routes[0]
	for _, s := range r.Steps[1:] {
		p := r.Coordinates[s.Shape]
		controls = append(controls, Control{Kind: "cédez", Lat: p[1], Lon: p[0]})
	}
	Annotate(&r, controls)
	if r.Steps[2].Control != "feu" || r.Steps[11].Control != "stop" {
		t.Fatalf("feu ou stop écrasé : %q, %q", r.Steps[2].Control, r.Steps[11].Control)
	}
	n := 0
	for _, s := range r.Steps {
		if s.Control == "cédez" {
			n++
			if !strings.HasPrefix(s.Instruction, "Au cédez-le-passage, ") {
				t.Errorf("consigne : %q", s.Instruction)
			}
		}
	}
	if n == 0 {
		t.Fatal("aucune manœuvre au cédez-le-passage")
	}
}

// Valhalla rédige les annonces vocales ; elles sont rattachées à la manœuvre qu'elles préparent,
// et le feu y est annoncé comme dans le bandeau.
func TestVoice(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-saint-remi-voix.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
	if err != nil {
		t.Fatal(err)
	}
	r := routes[0]
	if len(r.Steps[0].Voice) != 0 {
		t.Errorf("départ : %+v", r.Steps[0].Voice)
	}
	want := []Voice{
		{51.6, "Conduisez vers le sud-est sur Cour de la Gare. Ensuite, tournez à droite dans Boulevard Joffre."},
		{12.9, "Tournez à droite dans Boulevard Joffre."},
	}
	if !slices.Equal(r.Steps[1].Voice, want) {
		t.Errorf("étape 1 : %+v", r.Steps[1].Voice)
	}
	if got := r.Steps[2].Voice[1].Text; got != "Dans 100 mètres, faites demi-tour à gauche dans Boulevard Louis Roederer." {
		t.Errorf("annonce : %q", got)
	}
	p := r.Coordinates[r.Steps[3].Shape]
	Annotate(&r, []Control{{Kind: "feu", Lat: p[1], Lon: p[0]}})
	if r.Steps[3].Control != "feu" {
		t.Fatalf("feu non retenu : %+v", r.Steps[3])
	}
	for i, w := range []string{
		"Continuez pendant 600 mètres.",
		"Dans 200 mètres, au feu, tournez à droite dans Place de la République.",
		"Au feu, tournez à droite dans Place de la République, N 44.",
	} {
		if got := r.Steps[3].Voice[i].Text; got != w {
			t.Errorf("annonce %d : %q, attendu %q", i, got, w)
		}
	}
}

// Sur la carte : un repère par carrefour du trajet, posé sur le tracé, dans l'ordre de passage ;
// le stop de la manœuvre de Rue Damide y est, pas ceux des rues transversales.
func TestPlaceControls(t *testing.T) {
	body, err := os.ReadFile("testdata/gare-saint-remi.json")
	if err != nil {
		t.Fatal(err)
	}
	routes, err := fakeValhalla(t, http.StatusOK, body).Routes(context.Background(), gare, cathedrale, Car, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var controls []Control
	raw, _ := os.ReadFile("testdata/controles-saint-remi.json")
	if err := json.Unmarshal(raw, &controls); err != nil {
		t.Fatal(err)
	}
	r := routes[0]
	Annotate(&r, controls)
	Place(&r, controls)
	cum := make([]float64, len(r.Coordinates))
	for i := 1; i < len(cum); i++ {
		cum[i] = cum[i-1] + meters(r.Coordinates[i-1], r.Coordinates[i])
	}
	var got []string
	prev := -1.0
	for _, c := range r.Controls {
		along, off := project(r.Coordinates, cum, [2]float64{c.Lon, c.Lat}, 0, cum[len(cum)-1])
		if off > 0.5 || along <= prev {
			t.Fatalf("%+v : écart %.1f m, abscisse %.0f après %.0f", c, off, along, prev)
		}
		prev = along
		got = append(got, fmt.Sprintf("%s@%.0f", c.Kind, along))
	}
	// Les deux feux de la gare (184 et 227 m, deux carrefours), un par carrefour à 4 704 et 5 495 m
	// (les feux de chaque branche fusionnés), 6 118 m, et le stop de Rue Damide (7 744 m). Écartés :
	// le stop à 12 m du tracé (rue transversale) et le feu à 11 m de 402 m.
	want := []string{"feu@184", "feu@227", "feu@4704", "feu@5495", "feu@6118", "stop@7744"}
	if !slices.Equal(got, want) {
		t.Fatalf("repères %v, attendu %v", got, want)
	}
}
