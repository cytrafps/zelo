package tarif

import "testing"

// Montants recalculés à la main depuis les grilles publiées (voir tarifs.json).
func TestPrices(t *testing.T) {
	cases := []struct {
		id   string
		want map[int]int // minutes → centimes
	}{
		// 30 min offertes, puis 0,60 € le quart d'heure jusqu'à 2 h, 0,50 € jusqu'à 8 h…, plafond 17 €.
		{"way/31432939", map[int]int{30: 0, 31: 60, 60: 120, 120: 360, 180: 560, 480: 1560, 720: 1700, 1440: 1700}},
		// République : 0,60 € jusqu'à 3 h, puis 0,50 € jusqu'à 8 h, 0,40 € jusqu'à 9 h, 0,30 € jusqu'à 12 h, 21,50 € au-delà.
		{"way/720964467", map[int]int{60: 120, 180: 600, 480: 1600, 720: 2120, 721: 2150, 1440: 2150}},
		// Effia : prix « jusqu'à ».
		{"way/87834494", map[int]int{30: 0, 45: 180, 60: 180, 180: 410, 1440: 1290}},
	}
	for _, c := range cases {
		g := table.Parkings[c.id]
		for m, want := range c.want {
			if got := g.price(m); got != want {
				t.Errorf("%s (%s), %d min : %d c, attendu %d", c.id, g.Name, m, got, want)
			}
		}
	}
}

func TestFor(t *testing.T) {
	if For("way/1") != nil {
		t.Error("parking sans relevé : nil attendu")
	}
	s := For("way/31432939")
	if s == nil || s.Free != 30 || len(s.Prices) != len(Durations) || s.Prices[0] != (Price{60, 120}) || s.Source == "" || s.Checked == "" {
		t.Fatalf("%+v", s)
	}
	// Toutes les grilles sont lisibles et donnent les durées affichées.
	for id := range table.Parkings {
		if got := For(id); len(got.Prices) != len(Durations) {
			t.Errorf("%s : %+v", id, got)
		}
	}
}
