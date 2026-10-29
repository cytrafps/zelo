package route

import "testing"

func TestTollPassages(t *testing.T) {
	// Tracé est-ouest de ~4,4 km : autoroute, 1 km de route locale (sortie puis retour), autoroute.
	pts := [][2]float64{{4.00, 49.0}, {4.01, 49.0}, {4.02, 49.0}, {4.03, 49.0}, {4.04, 49.0}, {4.05, 49.0}, {4.06, 49.0}}
	r := Route{Coordinates: pts, motorway: []bool{true, true, false, false, true, true, true}, tolled: make([]bool, len(pts))}
	got := TollPassages(&r, []TollPoint{
		{Gare: "C", Lat: 49.0, Lon: 4.045},     // après la route locale
		{Gare: "A", Lat: 49.0, Lon: 4.005},     // d'abord
		{Gare: "B", Lat: 49.0, Lon: 4.015},     // avant de sortir
		{Gare: "loin", Lat: 49.001, Lon: 4.02}, // ~110 m du tracé : pas franchi
	})
	if len(got) != 3 || got[0].Gare != "A" || got[1].Gare != "B" || got[2].Gare != "C" {
		t.Fatalf("ordre : %+v", got)
	}
	if got[1].Break || !got[2].Break {
		t.Fatalf("sortie d'autoroute entre B et C seulement : %+v", got)
	}
	if r.HasToll() {
		t.Fatal("aucun tronçon à péage")
	}
	r.tolled[3] = true
	if !r.HasToll() {
		t.Fatal("tronçon à péage non vu")
	}
}
