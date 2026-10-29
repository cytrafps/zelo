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
	// Publié « monday 23:00Z–06:00Z », « friday 18:00Z–22:59Z », « saturday/sunday 23:00Z–22:59Z » :
	// saisi en heure de Paris (hiver), soit lundi 0 h–7 h, vendredi 19 h–23 h 59, samedi et dimanche.
	for s, want := range map[string]bool{
		"2026-11-02 03:00": true,  // lundi 3 h
		"2026-11-02 07:30": false, // lundi après 7 h
		"2026-11-03 03:00": false, // mardi 3 h (l'ancienne lecture fermait le mardi)
		"2026-11-06 20:00": true,  // vendredi soir
		"2026-11-06 18:30": false, // vendredi avant 19 h
		"2026-11-07 00:30": true,  // samedi, toute la journée
		"2026-11-08 15:00": true,  // dimanche
		"2026-11-09 00:30": true,  // lundi 0 h 30 : le créneau du lundi commence à 0 h
		"2026-11-04 15:00": false, // mercredi après-midi
		"2027-06-07 06:30": true,  // lundi 6 h 30 en été : même heure de Paris qu'en hiver
		"2027-06-07 07:30": false, // lundi 7 h 30 en été
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
	// Saisi en hiver (+01:00) : vendredi 23 h → samedi 5 h, heure de Paris.
	p, ok := period("22:00:00+00:00", "04:00:00+00:00", []string{"friday"}, time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC))
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

// Une fermeture dont un créneau est illisible n'est pas retenue (sinon elle s'appliquerait en
// continu) ; deux validités gardent chacune leurs dates et leurs créneaux.
func TestWindows(t *testing.T) {
	if _, ok := period("25:00:00+00:00", "04:00:00+00:00", nil, time.Time{}); ok {
		t.Error("heure illisible acceptée")
	}
	if _, ok := period("22:00:00+00:00", "04:00:00+00:00", []string{"lundi"}, time.Time{}); ok {
		t.Error("jour illisible accepté")
	}
	day := func(d int) time.Time { return time.Date(2026, 11, d, 0, 0, 0, 0, Paris) }
	nights, _ := period("19:00:00+00:00", "21:00:00+00:00", nil, day(1)) // 20 h–22 h à Paris
	c := Closure{Windows: []Window{
		{From: day(1), To: day(8), Periods: []Period{nights}}, // la première semaine, le soir
		{From: day(20)}, // à partir du 20, en continu et sans fin
	}}
	for at, want := range map[time.Time]bool{
		day(3).Add(21 * time.Hour):  true,  // soir de la première semaine
		day(3).Add(10 * time.Hour):  false, // matin de la première semaine
		day(12).Add(21 * time.Hour): false, // entre les deux : la fusion l'aurait fermée
		day(25).Add(10 * time.Hour): true,
	} {
		if c.Active(at) != want {
			t.Errorf("%v : active=%v, attendu %v", at, !want, want)
		}
	}
}
