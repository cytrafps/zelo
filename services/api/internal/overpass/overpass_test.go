package overpass

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestFetchRetriesWhenBusy(t *testing.T) {
	backoff = []time.Duration{time.Millisecond, time.Millisecond}
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Write([]byte(`{"elements":[{"type":"node","id":1,"lat":49.25,"lon":4.03}]}`))
	}))
	defer srv.Close()

	els, err := Fetch(context.Background(), srv.Client(), srv.URL, "q")
	if err != nil || len(els) != 1 || calls.Load() != 3 {
		t.Fatalf("els=%v err=%v appels=%d, attendu 1 élément au 3e appel", els, err, calls.Load())
	}
}

func TestFetchGivesUp(t *testing.T) {
	backoff = []time.Duration{time.Millisecond}
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	if _, err := Fetch(context.Background(), srv.Client(), srv.URL, "q"); err == nil || calls.Load() != 2 {
		t.Fatalf("err=%v appels=%d, attendu une erreur après 2 appels", err, calls.Load())
	}
}

func TestFetchNoRetryOnBadRequest(t *testing.T) {
	backoff = []time.Duration{time.Millisecond}
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	if _, err := Fetch(context.Background(), srv.Client(), srv.URL, "q"); err == nil || calls.Load() != 1 {
		t.Fatalf("err=%v appels=%d, attendu une erreur au 1er appel", err, calls.Load())
	}
}

// Trois imports lancés ensemble : jamais deux requêtes en même temps.
func TestFetchOneAtATime(t *testing.T) {
	var inflight, peak atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := inflight.Add(1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		time.Sleep(20 * time.Millisecond)
		inflight.Add(-1)
		w.Write([]byte(`{"elements":[]}`))
	}))
	defer srv.Close()

	done := make(chan error, 3)
	for range 3 {
		go func() { _, err := Fetch(context.Background(), srv.Client(), srv.URL, "q"); done <- err }()
	}
	for range 3 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if peak.Load() != 1 {
		t.Fatalf("%d requêtes simultanées, attendu 1", peak.Load())
	}
}
