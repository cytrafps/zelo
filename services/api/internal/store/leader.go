package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// CollectorLock identifie le verrou consultatif PostgreSQL des collectes.
const CollectorLock int64 = 0x7a656c6f // « zelo »

// Intervalles de l'élection, modifiables par les tests.
var (
	leaderRetry = 15 * time.Second // un suiveur retente de prendre le verrou
	leaderCheck = 5 * time.Second  // le meneur vérifie que sa connexion (donc son verrou) tient
)

// RunAsLeader exécute run tant que cette instance détient le verrou key ; une seule instance
// du cluster à la fois. Le verrou appartient à une session PostgreSQL : si l'instance meurt ou
// perd la base, la session se ferme, le verrou se libère et une autre instance prend le relais.
// onChange signale chaque prise ou perte du rôle. Retourne quand ctx est annulé.
func (s *Store) RunAsLeader(ctx context.Context, key int64, run func(context.Context), onChange func(bool)) {
	for ctx.Err() == nil {
		if s.leadOnce(ctx, key, run, onChange) {
			continue // rôle perdu : on retente aussitôt
		}
		select {
		case <-ctx.Done():
		case <-time.After(leaderRetry):
		}
	}
}

// leadOnce renvoie true si cette instance a été meneuse pendant l'appel.
func (s *Store) leadOnce(ctx context.Context, key int64, run func(context.Context), onChange func(bool)) bool {
	conn, err := pgx.Connect(ctx, s.url)
	if err != nil {
		return false
	}
	defer conn.Close(context.WithoutCancel(ctx))
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil || !got {
		return false
	}

	onChange(true)
	defer onChange(false)
	runCtx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		run(runCtx)
	}()
	tick := time.NewTicker(leaderCheck)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
		case <-tick.C:
			pctx, cancel := context.WithTimeout(ctx, leaderCheck)
			err := conn.Ping(pctx)
			cancel()
			if err == nil {
				continue
			}
		}
		stop()
		<-done
		return true
	}
}
