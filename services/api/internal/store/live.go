package store

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// LiveChannel est le canal PostgreSQL LISTEN/NOTIFY des événements temps réel.
// Chaque instance de l'API l'écoute : un signalement reçu par l'une atteint les clients de toutes.
const LiveChannel = "zelo_live"

// LiveEvent est le message envoyé aux clients WebSocket.
type LiveEvent struct {
	Type   string  `json:"type"`
	Report *Report `json:"report,omitempty"`
}

func notify(ctx context.Context, tx pgx.Tx, ev LiveEvent) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT pg_notify($1, $2)`, LiveChannel, string(payload))
	return err
}

// Listen transmet chaque événement du canal à onEvent, jusqu'à l'annulation de ctx.
// La connexion est dédiée (LISTEN ne passe pas par le pool) et rétablie en cas de coupure.
func (s *Store) Listen(ctx context.Context, log *slog.Logger, onEvent func([]byte)) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.listenOnce(ctx, onEvent, func() { backoff = time.Second })
		if ctx.Err() != nil {
			return
		}
		log.Warn("flux temps réel coupé, reconnexion", "err", err, "dans", backoff.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(2*backoff, 30*time.Second)
	}
}

func (s *Store) listenOnce(ctx context.Context, onEvent func([]byte), connected func()) error {
	conn, err := pgx.Connect(ctx, s.url)
	if err != nil {
		return err
	}
	defer conn.Close(context.WithoutCancel(ctx))
	if _, err := conn.Exec(ctx, "LISTEN "+LiveChannel); err != nil {
		return err
	}
	connected()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		onEvent([]byte(n.Payload))
	}
}
