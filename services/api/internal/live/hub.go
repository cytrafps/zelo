// Package live diffuse les événements (nouveaux signalements) aux clients WebSocket.
//
// Le hub sert les clients de cette instance ; les événements lui arrivent de PostgreSQL
// (LISTEN/NOTIFY, voir store.Listen), ce qui les partage entre toutes les instances de l'API.
package live

import (
	"sync"

	"github.com/cytrafps/zelo/services/api/internal/metrics"
)

// Buffer : événements en attente par client. Plein, le client est trop lent (réseau saturé) :
// il est déconnecté, se reconnecte et recharge les signalements, plutôt que d'en perdre en silence.
const Buffer = 32

type Hub struct {
	mu      sync.Mutex
	max     int
	closed  bool
	clients map[chan []byte]struct{}
}

// NewHub accepte au plus max clients (0 : sans limite) : chaque client coûte une goroutine et
// une socket, une vague de connexions ne doit pas épuiser l'instance.
func NewHub(max int) *Hub { return &Hub{max: max, clients: make(map[chan []byte]struct{})} }

// Subscribe renvoie un canal d'événements et la fonction pour se désinscrire ; ok est faux si
// l'instance est pleine ou s'arrête. Le canal est fermé quand le client doit partir.
func (h *Hub) Subscribe() (events <-chan []byte, unsubscribe func(), ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || (h.max > 0 && len(h.clients) >= h.max) {
		metrics.LiveRejected.Inc()
		return nil, func() {}, false
	}
	ch := make(chan []byte, Buffer)
	h.clients[ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		h.drop(ch)
		h.mu.Unlock()
	}, true
}

// drop retire et ferme le canal d'un client (h.mu tenu).
func (h *Hub) drop(ch chan []byte) {
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
}

// Broadcast n'attend jamais : un client dont le tampon est plein est déconnecté.
func (h *Hub) Broadcast(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
			metrics.LiveDropped.Inc()
			h.drop(ch)
		}
	}
}

// Close ferme tous les flux (arrêt de l'instance) : les clients se reconnectent sur une autre.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for ch := range h.clients {
		h.drop(ch)
	}
}

func (h *Hub) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}
