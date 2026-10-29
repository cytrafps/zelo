package toll

import (
	"strings"
	"testing"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

func TestGareNamesUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, n := range Sanef {
		for _, g := range n.Gares {
			if seen[g] {
				t.Errorf("gare %q en double : Lookup par nom ambigu", g)
			}
			seen[g] = true
		}
	}
}

func TestMatch(t *testing.T) {
	for _, c := range []struct {
		booth Booth
		want  string // "" : pas de gare
	}{
		{Booth{Name: "Péage de Thillois"}, "REIMS OUEST (péage de Thillois) N°22"},
		{Booth{Name: "Barrière de péage de Taissy"}, "REIMS EST (péage de Taissy)"},
		{Booth{Name: "Reims Sud"}, "REIMS SUD N°23"},
		{Booth{Name: "Péage de Courcy"}, "REIMS (péage de Courcy)"},
		{Booth{Name: "Péage de Reims"}, ""}, // « Reims » : Courcy ne se reconnaît qu'à son nom de péage
		// Nom donné par OSM aux barrières de Taissy : « Reims Est » désigne une seule gare.
		{Booth{Name: "Péage de Reims Est"}, "REIMS EST (péage de Taissy)"},
		{Booth{Name: "Reims Nord"}, "REIMS NORD (péage d'Ormes)"},
		{Booth{Name: "Châlons-en-Champagne"}, "CHÂLONS-EN-CHAMPAGNE / LA VEUVE N°24"},
		{Booth{Name: "La Neuvillette"}, "LA NEUVILLETTE N°15"},
		{Booth{Name: "Saint-Quentin"}, ""},       // Nord ou Sud : on ne choisit pas
		{Booth{Name: "Péage de Saint-Witz"}, ""}, // inconnu de la grille
		// Sans nom : la sortie voisine, son numéro ET son nom.
		{Booth{Exit: "23", ExitName: "Reims-Sud"}, "REIMS SUD N°23"},
		{Booth{Exit: "23", ExitName: "Cormontreuil"}, ""},
		{Booth{Exit: "24", ExitName: "Châlons-en-Champagne"}, "CHÂLONS-EN-CHAMPAGNE / LA VEUVE N°24"},
		{Booth{Exit: "24"}, ""}, // numéro seul : jamais
		// Nommé autrement : la sortie voisine ne compte pas.
		{Booth{Name: "Parking Gare", Exit: "23", ExitName: "Reims-Sud"}, ""},
	} {
		g, ok := Match(c.booth)
		got := ""
		if ok {
			got = g.Name()
		}
		if got != c.want {
			t.Errorf("%+v : %q, attendu %q", c.booth, got, c.want)
		}
	}
}

func TestCompute(t *testing.T) {
	g := func(s string) string {
		t.Helper()
		gare, ok := Match(Booth{Name: s})
		if !ok {
			t.Fatalf("gare %q", s)
		}
		return gare.Name()
	}
	noisy := Sanef[0].Gares[0]
	for _, n := range Sanef {
		if n.Gares[0] != noisy && len(n.Gares) > 30 {
			noisy = n.Gares[0] // réseau A4 – A26 Sud : Paris / Noisy en tête
		}
	}
	thillois, taissy, courcy := g("Thillois"), g("Taissy"), g("Courcy")
	chalons, neuvillette := g("Châlons-en-Champagne"), g("La Neuvillette")
	dormans, vatry := g("Dormans"), g("Vatry")
	chateau, _ := Match(Booth{Exit: "20", ExitName: "Château-Thierry"})
	pass := func(names ...string) (out []Passage) {
		for _, n := range names {
			out = append(out, Passage{Gare: n})
		}
		return out
	}
	for _, c := range []struct {
		name     string
		passed   []Passage
		price    float64
		complete bool
	}{
		{"Reims → Paris", pass(thillois, thillois, noisy), 12.6, true},
		{"Thillois → Taissy → Châlons (traversée de Reims gratuite, même ticket)", pass(thillois, taissy, chalons), 4.8, true},
		{"deux réseaux à la suite", pass(courcy, taissy, chalons), 3.0, false}, // Courcy seul : barrière sans tarif
		{"sortie puis retour sur l'autoroute : deux tickets", []Passage{{Gare: chateau.Name()}, {Gare: dormans}, {Gare: thillois, Break: true}, {Gare: vatry}}, 2.3 + 7.1, true},
		{"poste non rattaché sur le trajet", []Passage{{Gare: dormans}, {Gare: ""}, {Gare: chalons}}, 0, false},
		{"péage fixe puis barrière", pass(neuvillette, courcy), 0.9, false},
		{"péage fixe seul", pass(neuvillette), 0.9, true},
		{"gare d'une ancienne grille", pass("GARE DISPARUE"), 0, false},
	} {
		f := Compute(Car, c.passed)
		if f == nil || f.Complete != c.complete || f.Price < c.price-1e-9 || f.Price > c.price+1e-9 {
			t.Errorf("%s : %+v, attendu %.2f complet=%v", c.name, f, c.price, c.complete)
		}
	}
	if Compute(Car, nil) != nil {
		t.Error("sans péage : nil attendu")
	}
}

// La requête doit rendre les coordonnées des nœuds (« out tags » ne les donne pas) et ne viser que
// les postes posés sur une autoroute ou une bretelle.
func TestQuery(t *testing.T) {
	q := Query(overpass.BBox{MinLon: 3.38, MinLat: 48.51, MaxLon: 5.04, MaxLat: 49.41})
	if !strings.HasSuffix(q, ";);out;") || !strings.Contains(q, `node(w.m)["barrier"="toll_booth"]`) {
		t.Fatalf("requête : %s", q)
	}
}
