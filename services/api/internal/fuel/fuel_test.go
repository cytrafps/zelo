package fuel

import (
	"os"
	"testing"
)

func TestParse(t *testing.T) {
	f, err := os.Open("testdata/sample.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	got, err := Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("stations = %d, want 2 (station sans coordonnées ignorée)", len(got))
	}
	s := got[0]
	if s.ID != "51100004" || s.City != "Reims" {
		t.Errorf("station = %+v", s)
	}
	if s.Lat < 49.25 || s.Lat > 49.26 || s.Lon < 4.03 || s.Lon > 4.04 {
		t.Errorf("coordonnées = %v, %v", s.Lat, s.Lon)
	}
	if len(s.Prices) != 2 {
		t.Fatalf("prix = %d, want 2 (prix invalide ignoré)", len(s.Prices))
	}
	if p := s.Prices[0]; p.Fuel != "Gazole" || p.Value != 1.789 {
		t.Errorf("prix = %+v", p)
	}
	if got[1].City != "Épernay" {
		t.Errorf("accents ISO-8859-1 mal décodés : %q", got[1].City)
	}
}

func TestCoord(t *testing.T) {
	cases := []struct {
		in   string
		max  float64
		want float64
		ok   bool
	}{
		{"4925590", 90, 49.2559, true},
		{"49.2559", 90, 49.2559, true},
		{"403420", 180, 4.0342, true},
		{"", 90, 0, false},
		{"0", 90, 0, false},
	}
	for _, c := range cases {
		v, ok := coord(c.in, c.max)
		if ok != c.ok || (ok && (v-c.want > 1e-9 || c.want-v > 1e-9)) {
			t.Errorf("coord(%q) = %v, %v ; want %v, %v", c.in, v, ok, c.want, c.ok)
		}
	}
}
