package closure

import (
	"os"
	"testing"
	"time"
)

var marne = BBox{3.38, 48.51, 5.04, 49.41}

// Extrait réel de DiaLog (28 octobre 2026) : la rue Buirette, piétonne à heures fixes ; une
// interdiction aux poids lourds (rue de Courcelles) ; une fermeture temporaire à Paris.
func TestParse(t *testing.T) {
	f, err := os.Open("testdata/dialog-extrait.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := Parse(f, marne)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("%d fermetures, attendu la seule rue Buirette : %+v", len(got), got)
	}
	c := got[0]
	if c.Name != "Rue Buirette, de la place Drouet d'Erlon jusqu'à la rue Jeanne d'Arc" || len(c.Lines) == 0 || c.URL == "" {
		t.Errorf("%+v", c)
	}
	paris, _ := time.LoadLocation("Europe/Paris")
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, paris)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for s, want := range map[string]bool{
		"2026-11-03 03:00": true,  // nuit de lundi à mardi (23 h - 6 h UTC)
		"2026-11-03 10:00": false, // mardi matin : ouverte
		"2026-11-06 20:00": true,  // vendredi soir (18 h - 23 h UTC)
		"2026-11-08 15:00": true,  // dimanche
		"2026-11-04 15:00": false, // mercredi après-midi
	} {
		if c.Active(at(s)) != want {
			t.Errorf("%s : active=%v, attendu %v", s, !want, want)
		}
	}
	if c.Active(at("2021-01-01 03:00")) {
		t.Error("avant l'arrêté : pas de fermeture")
	}
}

func TestPeriodOverMidnight(t *testing.T) {
	p, ok := period("22:00:00+00:00", "04:00:00+00:00", []string{"friday"})
	if !ok {
		t.Fatal("créneau illisible")
	}
	c := Closure{Periods: []Period{p}}
	fri := time.Date(2026, 10, 30, 23, 0, 0, 0, time.UTC)
	if !c.Active(fri) || !c.Active(fri.Add(4*time.Hour)) || c.Active(fri.Add(6*time.Hour)) || c.Active(fri.Add(-2*time.Hour)) {
		t.Error("vendredi 22 h → samedi 4 h attendu")
	}
	end := Closure{To: fri}
	if end.Active(fri) || !end.Active(fri.Add(-time.Second)) {
		t.Error("fin de validité")
	}
}
