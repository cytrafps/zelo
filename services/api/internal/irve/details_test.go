package irve

import "testing"

func TestMaxHeight(t *testing.T) {
	for in, want := range map[string]float64{
		"Hauteur maximale 1.90m": 1.9, "Hauteur maximum 2m": 2, "Hauteur maximale si barrière : 2,3m": 2.3,
		"1.9": 1.9, "3m": 3, "2,05": 2.05,
	} {
		if got := maxHeight(in); got == nil || *got != want {
			t.Errorf("%q : %v, attendu %v", in, got, want)
		}
	}
	for _, in := range []string{"15m²", "99999", "0", "inconnu", "Aucune Restriction", "xx", ""} {
		if got := maxHeight(in); got != nil {
			t.Errorf("%q : %v, attendu rien", in, *got)
		}
	}
}

func TestPMRAndPlacement(t *testing.T) {
	if pmr("Réservé PMR") != "réservé" || pmr("Accessibilité inconnue") != "" {
		t.Error("pmr")
	}
	if placement("Parking privé réservé à la clientèle") != "parking-clients" || placement("Parking public") != "parking" {
		t.Error("placement")
	}
}
