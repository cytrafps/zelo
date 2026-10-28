package live

import "testing"

func TestSlowClientIsDisconnected(t *testing.T) {
	h := NewHub(0)
	slow, _, _ := h.Subscribe()
	fast, unsubscribe, _ := h.Subscribe()
	defer unsubscribe()
	for range Buffer + 1 {
		h.Broadcast([]byte("x"))
		<-fast
	}
	n := 0
	for range slow {
		n++
	}
	if n != Buffer {
		t.Fatalf("le client lent a reçu %d événements avant d'être coupé, attendu %d", n, Buffer)
	}
	if h.Len() != 1 {
		t.Fatalf("%d clients, attendu 1", h.Len())
	}
}

func TestMaxAndClose(t *testing.T) {
	h := NewHub(1)
	ch, _, ok := h.Subscribe()
	if !ok {
		t.Fatal("premier client refusé")
	}
	if _, _, ok := h.Subscribe(); ok {
		t.Fatal("client au-delà du maximum accepté")
	}
	h.Close()
	if _, open := <-ch; open {
		t.Fatal("canal encore ouvert après Close")
	}
	if _, _, ok := h.Subscribe(); ok {
		t.Fatal("client accepté après Close")
	}
}
