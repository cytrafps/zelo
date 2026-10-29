package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Report struct {
	ID            int64     `json:"id"`
	Kind          string    `json:"kind"`
	Lat           float64   `json:"lat"`
	Lon           float64   `json:"lon"`
	CreatedAt     time.Time `json:"createdAt"`
	ExpiresAt     time.Time `json:"expiresAt"`
	Confirmations int       `json:"confirmations"`
	Denials       int       `json:"denials"`
}

// Voter : qui signale ou vote, sans compte. Device : l'appareil (un vote par appareil). Net : son
// réseau (/24 IPv4, /64 IPv6), qui ne compte qu'une fois : inventer des identifiants d'appareil ne
// donne pas plus de voix. Deux empreintes, jamais l'adresse elle-même.
type Voter struct{ Device, Net string }

var (
	ErrReportNotFound = errors.New("signalement introuvable ou expiré")
	ErrOwnReport      = errors.New("on ne vote pas pour son propre signalement")
)

// Règles de fiabilité.
const (
	// MergeRadius : un signalement du même type à moins de 150 m est un doublon ; il compte
	// comme une confirmation du signalement existant au lieu d'en créer un second.
	MergeRadius = 150.0
	// Un signalement disparaît dès qu'au moins 2 réseaux différents l'infirment et qu'ils sont plus
	// nombreux que ceux qui le confirment.
	minDenials = 2
)

const reportColumns = `id, kind, ST_Y(geom::geometry), ST_X(geom::geometry), created_at, expires_at, confirmations, denials`

// AddReport enregistre un signalement, ou confirme le doublon proche s'il en existe un
// (created = false). L'événement part à toutes les instances (NOTIFY) dans la même transaction.
func (s *Store) AddReport(ctx context.Context, kind string, lat, lon float64, ttl time.Duration, voter Voter) (r Report, created bool, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		// Recherche puis verrouillage en deux temps : FOR UPDATE ne se combine pas au tri KNN (<->).
		var dup int64
		err := tx.QueryRow(ctx, `
			WITH near AS (
				SELECT id FROM report
				WHERE kind = $1 AND expires_at > now()
				  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
				ORDER BY geom <-> ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
				LIMIT 1
			)
			SELECT r.id FROM report r JOIN near USING (id) WHERE r.expires_at > now() FOR UPDATE OF r`,
			kind, lat, lon, MergeRadius).Scan(&dup)
		switch {
		case err == nil:
			r, _, err = vote(ctx, tx, dup, voter, true, ttl)
			if errors.Is(err, ErrOwnReport) { // le même appareil re-signale : rien de neuf
				r, err = getReport(ctx, tx, dup)
				return err
			}
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		created = true
		if err := tx.QueryRow(ctx, `
			INSERT INTO report (kind, geom, expires_at, reporter, reporter_net)
			VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, now() + make_interval(secs => $4), $5, $6)
			RETURNING `+reportColumns, kind, lat, lon, ttl.Seconds(), voter.Device, voter.Net).Scan(reportFields(&r)...); err != nil {
			return err
		}
		return notify(ctx, tx, LiveEvent{Type: "report", Report: &r})
	})
	return r, created, err
}

// Vote enregistre « toujours là » (up) ou « plus là » pour un appareil ; un nouveau vote du
// même appareil remplace le précédent. Une confirmation prolonge le signalement de ttl/2 ;
// assez d'infirmations le retirent (removed = true).
func (s *Store) Vote(ctx context.Context, id int64, voter Voter, up bool, ttl func(kind string) time.Duration) (r Report, removed bool, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var kind string
		if err := tx.QueryRow(ctx, `SELECT kind FROM report WHERE id = $1 AND expires_at > now() FOR UPDATE`, id).Scan(&kind); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrReportNotFound
			}
			return err
		}
		r, removed, err = vote(ctx, tx, id, voter, up, ttl(kind))
		return err
	})
	return r, removed, err
}

// vote suppose la ligne du signalement verrouillée (FOR UPDATE) par l'appelant.
func vote(ctx context.Context, tx pgx.Tx, id int64, voter Voter, up bool, ttl time.Duration) (Report, bool, error) {
	var reporter string
	if err := tx.QueryRow(ctx, `SELECT reporter FROM report WHERE id = $1`, id).Scan(&reporter); err != nil {
		return Report{}, false, err
	}
	if reporter != "" && reporter == voter.Device {
		return Report{}, false, ErrOwnReport
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO report_vote (report_id, voter, up, net) VALUES ($1, $2, $3, $4)
		ON CONFLICT (report_id, voter) DO UPDATE SET up = EXCLUDED.up, net = EXCLUDED.net, voted_at = now()`, id, voter.Device, up, voter.Net); err != nil {
		return Report{}, false, err
	}
	var r Report
	// Une voix par réseau ; le réseau de l'auteur ne confirme pas son propre signalement.
	err := tx.QueryRow(ctx, `
		WITH v AS (
			SELECT count(DISTINCT net) FILTER (WHERE up AND (rep.reporter_net = '' OR net <> rep.reporter_net)) AS yes,
			       count(DISTINCT net) FILTER (WHERE NOT up) AS no
			FROM report_vote, (SELECT reporter_net FROM report WHERE id = $1) rep
			WHERE report_id = $1
		)
		UPDATE report SET
			confirmations = v.yes,
			denials = v.no,
			expires_at = CASE
				WHEN v.no >= $4 AND v.no > v.yes THEN now()
				WHEN $2 THEN greatest(expires_at, now() + make_interval(secs => $3))
				ELSE expires_at
			END
		FROM v WHERE report.id = $1
		RETURNING `+reportColumns, id, up, ttl.Seconds()/2, minDenials).Scan(reportFields(&r)...)
	if err != nil {
		return Report{}, false, err
	}
	removed := r.Denials >= minDenials && r.Denials > r.Confirmations
	ev := LiveEvent{Type: "report", Report: &r}
	if removed {
		ev = LiveEvent{Type: "report_removed", ID: r.ID}
	}
	return r, removed, notify(ctx, tx, ev)
}

func getReport(ctx context.Context, tx pgx.Tx, id int64) (Report, error) {
	var r Report
	err := tx.QueryRow(ctx, `SELECT `+reportColumns+` FROM report WHERE id = $1`, id).Scan(reportFields(&r)...)
	return r, err
}

func reportFields(r *Report) []any {
	return []any{&r.ID, &r.Kind, &r.Lat, &r.Lon, &r.CreatedAt, &r.ExpiresAt, &r.Confirmations, &r.Denials}
}

func (s *Store) Reports(ctx context.Context, b BBox, limit int) ([]Report, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+reportColumns+`
		FROM report
		WHERE expires_at > now() AND ST_Intersects(geom, `+envelope+`)
		ORDER BY created_at DESC LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Report])
}
