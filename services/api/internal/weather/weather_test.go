package weather

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	f, err := os.Open("testdata/reims.json") // vraie réponse, 28 octobre 2026 au soir
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	slots, err := Parse(f)
	if err != nil || len(slots) != 24 {
		t.Fatalf("%d créneaux, %v", len(slots), err)
	}
	o, ok := At(slots, time.Date(2026, 10, 28, 21, 0, 0, 0, time.UTC))
	if !ok || o.Rain || o.Cold || o.TempC != 10.8 { // le plus froid entre 20 h 30 et 21 h 30
		t.Errorf("%+v %v", o, ok)
	}
	if _, ok := At(slots, time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)); ok {
		t.Error("hors prévision : rien à dire")
	}
}

func TestAtRainAndCold(t *testing.T) {
	t0 := time.Date(2026, 1, 10, 8, 0, 0, 0, time.UTC)
	slots := []Slot{{t0, 0, 3}, {t0.Add(15 * time.Minute), 0.6, 0.5}, {t0.Add(2 * time.Hour), 2, -3}}
	o, _ := At(slots, t0.Add(10*time.Minute))
	if !o.Rain || !o.Cold || o.RainMM != 0.6 || o.TempC != 0.5 {
		t.Errorf("%+v", o)
	}
}

func TestCache(t *testing.T) {
	calls := 0
	c := &Cache{TTL: time.Minute, Fetch: func(context.Context, float64, float64) ([]Slot, error) {
		calls++
		return []Slot{{}}, nil
	}}
	c.Get(context.Background(), 49.2535, 4.0341)
	c.Get(context.Background(), 49.2591, 4.0245) // même maille
	c.Get(context.Background(), 49.10, 4.0341)   // autre maille
	if calls != 2 {
		t.Errorf("%d appels, attendu 2", calls)
	}
}
