package weather

import (
	"context"
	"os"
	"sync/atomic"
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

// Open-Meteo plus lent que le client : la requête abandonne, la lecture se termine et sert la suivante.
func TestCacheOutlivesRequest(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	c := &Cache{TTL: time.Minute, Fetch: func(context.Context, float64, float64) ([]Slot, error) {
		calls.Add(1)
		<-release
		return []Slot{{}}, nil
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := c.Get(ctx, 49.25, 4.03); err == nil {
		t.Fatal("attendu l'expiration de la requête")
	}
	close(release)
	slots, err := c.Get(context.Background(), 49.25, 4.03)
	if err != nil || len(slots) != 1 || calls.Load() != 1 {
		t.Fatalf("slots=%v err=%v appels=%d, attendu la lecture déjà lancée", slots, err, calls.Load())
	}
}
