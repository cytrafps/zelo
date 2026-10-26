// Package live diffuse les événements (nouveaux signalements) aux clients WebSocket.
//
// Le hub sert les clients de cette instance ; les événements lui arrivent de PostgreSQL
// (LISTEN/NOTIFY, voir store.Listen), ce qui les partage entre toutes les instances de l'API.
package live

import (
	"sync"
)

type Hub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
}

func NewHub() *Hub { return &Hub{clients: make(map[chan []byte]struct{})} }

// Subscribe renvoie un canal d'événements et la fonction pour se désinscrire.
func (h *Hub) Subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 32)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.clients[ch]; ok {
			delete(h.clients, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

// Broadcast n'attend jamais : un client trop lent perd l'événement plutôt que de bloquer les autres.
func (h *Hub) Broadcast(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (h *Hub) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}
