package transit

import (
	"os"
	"testing"
	"time"
)

const (
	neufchatel = "103228"
	opera      = "135168"
	debre      = "103187"
)

func citura(t *testing.T) *Timetable {
	t.Helper()
	b, err := os.ReadFile("testdata/citura-tram.zip")
	if err != nil {
		t.Fatal(err)
	}
	tt, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	return tt
}

func TestParse(t *testing.T) {
	tt := citura(t)
	if len(tt.Lines) != 1 || tt.Lines["TRAM"].Name != "TRAM" || tt.Lines["TRAM"].Color != "E0001B" {
		t.Fatalf("lignes : %+v (le bus C doit être écarté)", tt.Lines)
	}
	names := map[string]string{}
	for _, s := range tt.Stops {
		names[s.ID] = s.Name
	}
	if names[neufchatel] != "NEUFCHATEL" || names[opera] != "OPERA-CATHEDRALE" {
		t.Fatalf("stations : %d, %v", len(tt.Stops), names)
	}
}

// Mardi 3 novembre 2026, 8 h : trams Neufchâtel → Opéra-Cathédrale, dans l'ordre, sans retour en arrière.
func TestRides(t *testing.T) {
	tt := citura(t)
	at := time.Date(2026, 11, 3, 8, 0, 0, 0, Paris)
	rides := tt.Rides(neufchatel, opera, at, time.Hour)
	if len(rides) < 4 {
		t.Fatalf("%d trams en une heure de pointe", len(rides))
	}
	for i, r := range rides {
		if r.Depart.Before(at) || !r.Arrive.After(r.Depart) || r.Stops < 3 {
			t.Errorf("tram %d : %+v", i, r)
		}
		if ride := r.Arrive.Sub(r.Depart); ride < 5*time.Minute || ride > 30*time.Minute {
			t.Errorf("tram %d : %v de trajet", i, ride)
		}
		if i > 0 && r.Depart.Before(rides[i-1].Depart) {
			t.Errorf("non trié")
		}
	}
	// Le sens inverse existe aussi, mais pas un « trajet » d'Opéra vers Opéra.
	if back := tt.Rides(opera, neufchatel, at, time.Hour); len(back) == 0 {
		t.Error("aucun tram dans l'autre sens")
	}
	if none := tt.Rides(opera, opera, at, time.Hour); len(none) != 0 {
		t.Errorf("trajet vers le même arrêt : %+v", none)
	}
	// Hors des dates du fichier : rien.
	if old := tt.Rides(neufchatel, opera, time.Date(2025, 1, 6, 8, 0, 0, 0, Paris), time.Hour); len(old) != 0 {
		t.Errorf("trams hors service : %d", len(old))
	}
}

func TestClockAfterMidnight(t *testing.T) {
	if s, err := clock("25:10:00"); err != nil || s != 25*3600+600 {
		t.Fatalf("%d %v", s, err)
	}
	if _, err := clock("8h10"); err == nil {
		t.Fatal("heure illisible acceptée")
	}
}
