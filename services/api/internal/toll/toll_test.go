package toll

import (
	"strings"
	"testing"
)

// gare : indice de la première gare du réseau dont le nom contient s.
func gare(t *testing.T, s string) (*Network, int) {
	t.Helper()
	for _, n := range Sanef {
		for i, g := range n.Gares {
			if strings.Contains(g, s) {
				return n, i
			}
		}
	}
	t.Fatalf("gare %q introuvable", s)
	return nil, 0
}

// Tarifs relevés à la main dans la grille Sanef du 1er février 2026.
func TestSanefGrid(t *testing.T) {
	if len(Sanef) != 3 {
		t.Fatalf("%d réseaux, 3 attendus", len(Sanef))
	}
	for _, c := range []struct {
		class   Class
		a, b    string
		want    float64
		present bool
	}{
		{Car, "Thillois", "Taissy", 2.8, true},
		{Car, "Taissy", "Thillois", 2.8, true}, // dans les deux sens
		{Car, "REIMS SUD", "REIMS NORD", 0.5, true},
		{Car, "CHÂLONS", "Thillois", 4.8, true},
		{Car, "STRASBOURG", "Taissy", 32.2, true},
		{Car, "PARIS / NOISY", "Thillois", 12.6, true},
		{Car, "Courcy", "LAON", 4.8, true},
		{Car, "Courcy", "CALAIS", 26.6, true},
		{Moto, "Thillois", "Taissy", 1.5, true},
		{Car, "REIMS NORD", "Thillois", 0, false}, // case grise
		{Car, "VERDUN", "Taissy", 0, false},       // section gratuite
	} {
		n, a := gare(t, c.a)
		m, b := gare(t, c.b)
		if n != m {
			t.Fatalf("%s et %s : réseaux différents", c.a, c.b)
		}
		got, ok := n.Price(c.class, a, b)
		if ok != c.present || got != c.want {
			t.Errorf("%s → %s (classe %d) : %v %v, attendu %v %v", c.a, c.b, c.class, got, ok, c.want, c.present)
		}
	}
	n, _ := gare(t, "Courcy")
	if p, ok := n.Flat(Car, "LA NEUVILLETTE N°15"); !ok || p != 0.9 {
		t.Errorf("La Neuvillette : %v %v", p, ok)
	}
}
