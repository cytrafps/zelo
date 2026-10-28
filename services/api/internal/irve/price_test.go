package irve

import "testing"

// Valeurs réelles du champ « tarification » autour de Reims (fichier consolidé, octobre 2026).
func TestParsePrice(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		from bool
		ok   bool
	}{
		{"HPC 59cts/Kwh", 0.59, false, true},
		{"AC 36cts/KWh", 0.36, false, true},
		{"0,35€/kWh + 0,03€/min entre 6h et 18h, 15€ la session entre 18h et 6h", 0.35, true, true},
		{"0,399 e/ kwh", 0.399, false, true},
		{"0.45€TTC/kWh", 0.45, false, true},
		{"0.69€ / kwh", 0.69, false, true},
		// Sans unité, ou sans montant : rien plutôt qu'un prix deviné.
		{"0.22", 0, false, false},
		{"0.4916", 0, false, false},
		{"Tarification au kWh plus frais de connexion éventuelles en fonction de l abonnement détenu", 0, false, false},
		{"Les tarifs de recharge peuvent varier en fonction de plusieurs facteurs", 0, false, false},
		{"Inconnu", 0, false, false},
		{"35€/kWh", 0, false, false}, // faute de saisie
	}
	for _, c := range cases {
		got, from, ok := parsePrice(c.in)
		if ok != c.ok || from != c.from || (ok && (got < c.want-1e-9 || got > c.want+1e-9)) {
			t.Errorf("%q : %v %v %v, attendu %v %v %v", c.in, got, from, ok, c.want, c.from, c.ok)
		}
	}
}
