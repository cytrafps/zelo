package zfe

import (
	"os"
	"testing"
)

// Extrait réel de la base nationale (mars 2026) : les deux arrêtés du Grand Reims et une ZFE
// hors de la Marne.
func TestParse(t *testing.T) {
	f, err := os.Open("testdata/aires-extrait.geojson")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := Parse(f, BBox{3.38, 48.51, 5.04, 49.41})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("%d aires, attendu les 2 du Grand Reims", len(got))
	}
	z := got[1]
	if z.ID != "200067213-ZFE-002" || z.Name != "ZFE du Grand Reims" || z.From != "2023-01-01" || z.To != "2028-12-31" {
		t.Errorf("%+v", z)
	}
	if z.Car == nil || *z.Car != (Rule{"V4", "24/7"}) || z.Moto != nil || len(z.Rings) == 0 || z.URL == "" {
		t.Errorf("règles : voiture %+v, moto %+v", z.Car, z.Moto)
	}
}
