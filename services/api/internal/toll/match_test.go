package toll

import "testing"

func name(g Gare) string { return Sanef[g.Net].Gares[g.Index] }

func TestMatch(t *testing.T) {
	for _, c := range []struct {
		booth Booth
		want  string // "" : pas de gare
	}{
		{Booth{Name: "Péage de Thillois"}, "REIMS OUEST (péage de Thillois) N°22"},
		{Booth{Name: "Barrière de péage de Taissy"}, "REIMS EST (péage de Taissy)"},
		{Booth{Name: "Reims Sud"}, "REIMS SUD N°23"},
		{Booth{Name: "Péage de Courcy"}, "REIMS (péage de Courcy)"},
		// Sans nom : la sortie la plus proche. Le n°23 existe sur l'A4 (Reims Sud) et l'A16
		// (Abbeville Nord) : son nom départage.
		{Booth{Exit: "23", ExitName: "Reims-Sud"}, "REIMS SUD N°23"},
		{Booth{Exit: "23", ExitName: "Cormontreuil"}, ""},
		{Booth{Exit: "24", ExitName: "Châlons-en-Champagne"}, "CHÂLONS-EN-CHAMPAGNE / LA VEUVE N°24"},
		{Booth{Name: "La Neuvillette"}, "LA NEUVILLETTE N°15"},
		{Booth{Name: "Péage de Saint-Witz"}, ""}, // nom inconnu de la grille, pas de sortie : rien
		{Booth{Name: "Saint-Quentin"}, ""},       // Saint-Quentin Nord ou Sud : on ne choisit pas
	} {
		g, ok := Match(c.booth)
		got := ""
		if ok {
			got = name(g)
		}
		if got != c.want {
			t.Errorf("%+v : %q, attendu %q", c.booth, got, c.want)
		}
	}
}

func TestCompute(t *testing.T) {
	at := func(s string) Gare {
		g, ok := Match(Booth{Name: s})
		if !ok {
			t.Fatalf("gare %q", s)
		}
		return g
	}
	// Reims → Paris : ticket à Thillois, paiement à Coutevroult (barrière de Paris / Noisy).
	thillois := at("Thillois")
	noisy := Gare{thillois.Net, 0}
	if f := Compute(Car, []Gare{thillois, thillois, noisy}); f == nil || !f.Complete || f.Price != 12.6 || len(f.Gares) != 2 {
		t.Errorf("Reims → Paris : %+v", f)
	}
	// Deux réseaux à la suite (A26 Nord puis A4 Sud par Reims) : deux tickets.
	courcy, taissy := at("Courcy"), at("Taissy")
	laon, _ := Match(Booth{Exit: "13", ExitName: "Laon"})
	chalons := at("Châlons-en-Champagne")
	if f := Compute(Car, []Gare{laon, courcy, taissy, chalons}); f == nil || !f.Complete || f.Price != 4.8+3.0 {
		t.Errorf("Laon → Châlons : %+v", f)
	}
	// Péage à prix fixe seul ; barrière seule (tarif inconnu) ; aucun péage.
	if f := Compute(Moto, []Gare{at("La Neuvillette")}); f == nil || !f.Complete {
		t.Errorf("La Neuvillette : %+v", f)
	}
	if f := Compute(Car, []Gare{courcy}); f == nil || f.Complete {
		t.Errorf("barrière seule : %+v", f)
	}
	if Compute(Car, nil) != nil {
		t.Error("sans péage : nil attendu")
	}
}
