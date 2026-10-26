package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	r, _, err := a.AddReport(ctx, "bouchon", 49.25, 4.03, time.Minute, "test-a")
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

func TestReportReliability(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	ttl := func(string) time.Duration { return time.Hour }
	lat, lon := 49.20, 4.10
	// Types propres à cette exécution : les signalements des exécutions précédentes ne comptent pas.
	run := fmt.Sprint(time.Now().UnixNano())
	accident, travaux := "accident-"+run, "travaux-"+run

	r, created, err := s.AddReport(ctx, accident, lat, lon, time.Hour, "alice")
	if err != nil || !created {
		t.Fatalf("création : %v (created=%v)", err, created)
	}

	// Doublon à ~50 m : c'est une confirmation, pas un nouveau signalement.
	dup, created, err := s.AddReport(ctx, accident, lat+0.0004, lon, time.Hour, "bob")
	if err != nil || created || dup.ID != r.ID || dup.Confirmations != 1 {
		t.Fatalf("doublon : %+v created=%v err=%v", dup, created, err)
	}
	// Autre type au même endroit : signalement distinct.
	if other, created, err := s.AddReport(ctx, travaux, lat, lon, time.Hour, "bob"); err != nil || !created || other.ID == r.ID {
		t.Fatalf("autre type : %+v created=%v err=%v", other, created, err)
	}

	if _, _, err := s.Vote(ctx, r.ID, "alice", false, ttl); !errors.Is(err, ErrOwnReport) {
		t.Fatalf("vote sur son signalement : %v", err)
	}

	// Une confirmation prolonge : il reste au moins ttl/2.
	conf, _, err := s.Vote(ctx, r.ID, "carol", true, ttl)
	if err != nil || conf.Confirmations != 2 || time.Until(conf.ExpiresAt) < 29*time.Minute {
		t.Fatalf("confirmation : %+v err=%v", conf, err)
	}

	// Bob change d'avis : son vote est remplacé, pas ajouté.
	if v, _, err := s.Vote(ctx, r.ID, "bob", false, ttl); err != nil || v.Confirmations != 1 || v.Denials != 1 {
		t.Fatalf("changement d'avis : %+v err=%v", v, err)
	}
	// 2 « plus là » contre 1 confirmation : retiré.
	if v, removed, err := s.Vote(ctx, r.ID, "dave", false, ttl); err != nil || !removed {
		t.Fatalf("aurait dû être retiré : %+v err=%v", v, err)
	}
	if _, _, err := s.Vote(ctx, r.ID, "frank", true, ttl); !errors.Is(err, ErrReportNotFound) {
		t.Fatalf("vote sur un signalement retiré : %v", err)
	}
}
