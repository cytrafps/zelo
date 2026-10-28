package servicearea

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// Aires de la Marne extraites d'OpenStreetMap, sous la forme que renvoie Overpass.
func marne(t *testing.T) map[string]Area {
	t.Helper()
	f, err := os.Open("testdata/marne.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	els, err := overpass.Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]Area{}
	for _, a := range FromElements(els) {
		out[a.Name] = a
	}
	return out
}

func TestMarne(t *testing.T) {
	areas := marne(t)
	sud, ok := areas["Aire de Reims Champagne-Sud"]
	if !ok {
		t.Fatalf("aire de Reims Champagne-Sud absente : %d aires", len(areas))
	}
	if sud.Kind != "services" || sud.Operator != "SANEF" || !slices.Contains(sud.Services, Toilettes) {
		t.Errorf("Reims Champagne-Sud : %+v", sud)
	}
	// Sur l'A4 au sud-est de Reims, vers Thuisy.
	if sud.Lat < 49.10 || sud.Lat > 49.14 || sud.Lon < 4.22 || sud.Lon > 4.27 {
		t.Errorf("centre de l'aire : %v, %v", sud.Lat, sud.Lon)
	}
	if want := []string{Restauration, Boutique, Toilettes, CampingCar, PiqueNique, Jeux}; !slices.Equal(sud.Services, want) {
		t.Errorf("services %v, attendu %v", sud.Services, want)
	}
	if v := areas["Aire de Vrigny"]; !slices.Contains(v.Services, Douches) {
		t.Errorf("Vrigny déclare des douches : %+v", v.Services)
	}
	for name, a := range areas {
		if name == "" && len(a.Services) == 0 {
			t.Errorf("aire anonyme sans service gardée : %s", a.ID)
		}
		if !slices.IsSortedFunc(a.Services, func(x, y string) int { return slices.Index(order, x) - slices.Index(order, y) }) {
			t.Errorf("%s : services dans le désordre %v", name, a.Services)
		}
	}
}

func TestServicesInside(t *testing.T) {
	els, err := overpass.Parse(strings.NewReader(`{"elements":[
		{"type":"way","id":1,"tags":{"highway":"services","name":"Aire test"},
		 "geometry":[{"lat":49,"lon":4},{"lat":49,"lon":4.01},{"lat":49.01,"lon":4.01},{"lat":49.01,"lon":4},{"lat":49,"lon":4}]},
		{"type":"node","id":2,"lat":49.005,"lon":4.005,"tags":{"amenity":"fast_food"}},
		{"type":"node","id":3,"lat":49.005,"lon":4.005,"tags":{"amenity":"sanitary_dump_station"}},
		{"type":"way","id":4,"center":{"lat":49.002,"lon":4.002},"tags":{"shop":"convenience"}},
		{"type":"node","id":5,"lat":49.02,"lon":4.005,"tags":{"leisure":"playground"}},
		{"type":"way","id":6,"tags":{"highway":"rest_area"},
		 "geometry":[{"lat":48,"lon":4},{"lat":48,"lon":4.01},{"lat":48.01,"lon":4.01},{"lat":48,"lon":4}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	got := FromElements(els)
	if len(got) != 1 {
		t.Fatalf("%d aires (l'aire anonyme sans service doit disparaître) : %+v", len(got), got)
	}
	// L'aire de jeux est hors du contour.
	if want := []string{Restauration, Boutique, CampingCar}; !slices.Equal(got[0].Services, want) {
		t.Fatalf("services %v, attendu %v", got[0].Services, want)
	}
}
