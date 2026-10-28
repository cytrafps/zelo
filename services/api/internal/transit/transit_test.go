package transit

import (
	"os"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

const (
	neufchatel = "103228"
	opera      = "135168"
)

func citura(t *testing.T) *Timetable {
	t.Helper()
	b, err := os.ReadFile("testdata/citura-3-novembre.zip")
	if err != nil {
		t.Fatal(err)
	}
	tt, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	return tt
}

func TestClockAfterMidnight(t *testing.T) {
	if s, err := clock("25:10:00"); err != nil || s != 25*3600+600 {
		t.Fatalf("%d %v", s, err)
	}
	if _, err := clock("8h10"); err == nil {
		t.Fatal("heure illisible acceptée")
	}
}

func stopID(t *testing.T, tt *Timetable, name string) string {
	t.Helper()
	for _, s := range tt.Stops {
		if s.Name == name {
			return s.ID
		}
	}
	t.Fatalf("arrêt %s absent", name)
	return ""
}

func TestParseKeepsTramAndBus(t *testing.T) {
	tt := citura(t)
	modes := map[string]int{}
	for _, l := range tt.Lines {
		modes[l.Mode]++
	}
	if modes["tram"] != 1 || modes["bus"] < 20 {
		t.Fatalf("lignes : %v", modes)
	}
	if tram := tt.Lines["TRAM"]; tram.Color != "E0001B" {
		t.Fatalf("tram : %+v", tram)
	}
}

// Mardi 3 novembre, 8 h : Neufchâtel → Opéra-Cathédrale en tram direct, trois départs successifs.
func TestPlanDirect(t *testing.T) {
	tt := citura(t)
	at := time.Date(2026, 11, 3, 8, 0, 0, 0, Paris)
	js := tt.Plan([]Access{{neufchatel, 2 * time.Minute}}, []Access{{opera, 3 * time.Minute}}, at, time.Hour, 3, nil)
	if len(js) != 3 {
		t.Fatalf("%d trajets", len(js))
	}
	for i, j := range js {
		if len(j.Legs) != 1 || j.Legs[0].Line.Mode != "tram" || j.Legs[0].Stops != 10 {
			t.Fatalf("trajet %d : %+v", i, j.Legs)
		}
		l := j.Legs[0]
		if l.Depart.Before(at.Add(2*time.Minute)) || !j.Arrive.Equal(l.Arrive.Add(3*time.Minute)) {
			t.Errorf("trajet %d : départ %v, arrivée %v (tram %v)", i, l.Depart, j.Arrive, l.Arrive)
		}
		if i > 0 && !l.Depart.After(js[i-1].Legs[0].Depart) {
			t.Errorf("trajet %d ne part pas après le précédent", i)
		}
	}
}

// Wilson n'est pas sur le tram : tram jusqu'à la gare, puis bus, avec la marge de correspondance.
func TestPlanTransfer(t *testing.T) {
	tt := citura(t)
	at := time.Date(2026, 11, 3, 8, 0, 0, 0, Paris)
	js := tt.Plan([]Access{{neufchatel, 2 * time.Minute}}, []Access{{stopID(t, tt, "WILSON"), 0}}, at, time.Hour, 2, nil)
	if len(js) == 0 {
		t.Fatal("aucun trajet")
	}
	var rides []Leg
	for _, l := range js[0].Legs {
		if l.Line != nil {
			rides = append(rides, l)
		}
	}
	if len(rides) != 2 || rides[0].Line.Mode != "tram" || rides[1].Line.Mode != "bus" {
		t.Fatalf("étapes : %+v", js[0].Legs)
	}
	if gap := rides[1].Depart.Sub(rides[0].Arrive); gap < Change {
		t.Fatalf("correspondance de %v, moins que la marge %v", gap, Change)
	}
}

// La nuit : rien dans la fenêtre demandée, même si le service reprend au matin.
func TestPlanNothingAtNight(t *testing.T) {
	tt := citura(t)
	at := time.Date(2026, 11, 4, 1, 0, 0, 0, Paris) // premier tram à 5 h 30, hors des deux heures
	if js := tt.Plan([]Access{{neufchatel, 0}}, []Access{{opera, 0}}, at, 2*time.Hour, 2, nil); len(js) != 0 {
		t.Fatalf("%+v", js)
	}
}

// Noms accentués repris d'OSM : « OPERA-CATHEDRALE » devient « Opéra-Cathédrale ».
func TestRename(t *testing.T) {
	tt := citura(t)
	f, err := os.Open("testdata/osm-arrets-reims.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	osm, err := overpass.Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	n := tt.Rename(osm)
	names := map[string]string{}
	for _, s := range tt.Stops {
		names[s.ID] = s.Name
	}
	if names[opera] != "Opéra-Cathédrale" {
		t.Errorf("Opéra : %q", names[opera])
	}
	if names[neufchatel] != "Neufchâtel" {
		t.Errorf("Neufchâtel : %q", names[neufchatel])
	}
	if n < len(tt.Stops)/2 {
		t.Errorf("%d stations renommées sur %d", n, len(tt.Stops))
	}
	if normalize("ST THOMAS") != normalize("Saint-Thomas") {
		t.Error("abréviation ST non développée")
	}
}
