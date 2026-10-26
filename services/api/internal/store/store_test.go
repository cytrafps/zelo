package store

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

// Tests d'intégration : ils demandent une vraie base PostGIS (ZELO_TEST_DATABASE_URL),
// fournie par la CI ; sans elle, ils sont ignorés.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("ZELO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ZELO_TEST_DATABASE_URL absent : test d'intégration ignoré")
	}
	s, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// Un signalement enregistré par une instance atteint les auditeurs de toutes les instances.
func TestReportReachesEveryInstance(t *testing.T) {
	a, b := testStore(t), testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	got := make(chan []byte, 4)
	go a.Listen(ctx, quiet, func(m []byte) { got <- m })
	go b.Listen(ctx, quiet, func(m []byte) { got <- m })
	time.Sleep(500 * time.Millisecond) // le temps que les deux LISTEN soient actifs

	r, err := a.AddReport(ctx, "bouchon", 49.25, 4.03, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2 {
		select {
		case m := <-got:
			var ev LiveEvent
			if err := json.Unmarshal(m, &ev); err != nil || ev.Type != "report" || ev.Report.ID != r.ID {
				t.Fatalf("événement %d = %s (%v)", i, m, err)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("seulement %d instance(s) sur 2 ont reçu le signalement", i)
		}
	}
}

// Une seule instance collecte ; si elle s'arrête, une autre prend le relais.
func TestSingleCollectorWithFailover(t *testing.T) {
	leaderRetry, leaderCheck = 200*time.Millisecond, 100*time.Millisecond
	s := testStore(t)
	key := time.Now().UnixNano() // verrou propre au test

	var active atomic.Int32
	var maxActive atomic.Int32
	run := func(ctx context.Context) {
		n := active.Add(1)
		for {
			m := maxActive.Load()
			if n <= m || maxActive.CompareAndSwap(m, n) {
				break
			}
		}
		<-ctx.Done()
		active.Add(-1)
	}
	leaders := make(chan int, 8)
	start := func(id int) context.CancelFunc {
		ctx, cancel := context.WithCancel(context.Background())
		go s.RunAsLeader(ctx, key, run, func(l bool) {
			if l {
				leaders <- id
			}
		})
		return cancel
	}

	stop1, stop2 := start(1), start(2)
	defer stop2()
	first := <-leaders
	time.Sleep(time.Second) // le suiveur retente plusieurs fois sans succès
	if maxActive.Load() != 1 {
		t.Fatalf("%d instances collectaient en même temps", maxActive.Load())
	}

	if first == 1 {
		stop1()
	} else {
		stop2()
		defer stop1()
	}
	select {
	case next := <-leaders:
		if next == first {
			t.Fatalf("l'instance arrêtée (%d) a repris la main", first)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("aucune instance n'a repris les collectes")
	}
	if maxActive.Load() != 1 {
		t.Fatalf("chevauchement : %d instances actives", maxActive.Load())
	}
}
