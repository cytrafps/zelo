package parking

import (
	"os"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	f, err := os.Open("testdata/sample.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(got))
	for i, p := range got {
		ids[i] = p.ID
	}
	// Exclus : 505 (petit, sans nom), 606 (privé), 707 (clients), 808 (pas un parking).
	if want := "way/101 node/202 way/303 way/404"; strings.Join(ids, " ") != want {
		t.Fatalf("ids = %v, want %s", ids, want)
	}

	c := got[0]
	if c.Name != "Parking Test Centre" || c.Kind != "underground" || c.Lat != 49.2556 || c.Lon != 4.0302 {
		t.Errorf("centre = %+v", c)
	}
	if *c.Capacity != 450 || *c.Disabled != 9 || *c.Charging != 4 || !*c.Fee || *c.MaxHeight != 1.9 || c.OpeningHours != "24/7" {
		t.Errorf("détails centre = cap %v pmr %v irve %v fee %v h %v", *c.Capacity, *c.Disabled, *c.Charging, *c.Fee, *c.MaxHeight)
	}

	pr := got[1]
	if !pr.ParkRide || pr.Capacity != nil || pr.Fee == nil || *pr.Fee || pr.Lat != 49.2610 {
		t.Errorf("relais = %+v", pr)
	}
	if got[2].MaxHeight != nil || got[2].Kind != "multi-storey" {
		t.Errorf("hauteur impériale ou type mal lus : %+v", got[2])
	}
}

func TestParseOverpassTimeout(t *testing.T) {
	_, err := Parse(strings.NewReader(`{"elements":[],"remark":"runtime error: Query timed out in \"query\" at line 1 after 91 seconds."}`))
	if err == nil {
		t.Fatal("une réponse expirée doit être une erreur, pas une liste vide")
	}
}

func TestMeters(t *testing.T) {
	for in, want := range map[string]float64{"2.1": 2.1, "2,10 m": 2.1, "1.9m": 1.9, " 2 ": 2} {
		if got := meters(in); got == nil || *got != want {
			t.Errorf("meters(%q) = %v, want %v", in, got, want)
		}
	}
	for _, in := range []string{"", "default", "none", "6'6\"", "0", "25"} {
		if got := meters(in); got != nil {
			t.Errorf("meters(%q) = %v, want nil", in, *got)
		}
	}
}

func TestQuery(t *testing.T) {
	q := Query(BBox{MinLon: 3.85, MinLat: 49.15, MaxLon: 4.25, MaxLat: 49.35})
	if !strings.Contains(q, `(49.15,3.85,49.35,4.25)`) {
		t.Fatalf("ordre sud,ouest,nord,est attendu : %s", q)
	}
}

// Arceaux vélo et places motos : gardés même petits et sans nom ; l'accès privé reste exclu.
func TestTwoWheels(t *testing.T) {
	ps, err := Parse(strings.NewReader(`{"elements":[
		{"type":"node","id":1,"lat":49.25,"lon":4.03,"tags":{"amenity":"bicycle_parking","capacity":"6","covered":"yes"}},
		{"type":"node","id":2,"lat":49.25,"lon":4.03,"tags":{"amenity":"motorcycle_parking"}},
		{"type":"node","id":3,"lat":49.25,"lon":4.03,"tags":{"amenity":"motorcycle_parking","access":"private"}},
		{"type":"node","id":4,"lat":49.25,"lon":4.03,"tags":{"amenity":"parking"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || ps[0].Vehicle != "bike" || !ps[0].Covered || *ps[0].Capacity != 6 || ps[1].Vehicle != "moto" {
		t.Fatalf("%+v", ps)
	}
}
