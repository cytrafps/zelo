// Package store persiste les données dans PostgreSQL + PostGIS.
package store

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cytrafps/zelo/services/api/internal/fuel"
	"github.com/cytrafps/zelo/services/api/internal/irve"
	"github.com/cytrafps/zelo/services/api/internal/junction"
	"github.com/cytrafps/zelo/services/api/internal/parking"
	"github.com/cytrafps/zelo/services/api/internal/servicearea"
)

//go:embed schema.sql
var schema string

type Store struct {
	db  *pgxpool.Pool
	url string // pour les connexions dédiées (LISTEN, verrou de collecte)
}

// Open attend la base jusqu'à 30 s : au démarrage d'un conteneur ou d'un pod,
// PostgreSQL peut encore être en train de s'initialiser.
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := poolConfig(url)
	if err != nil {
		return nil, err
	}
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pingRetry(ctx, db, 30*time.Second); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("schéma: %w", err)
	}
	return &Store{db: db, url: url}, nil
}

// poolConfig complète l'URL par des valeurs sûres, sauf si elle les fixe déjà
// (pool_max_conns, connect_timeout, options=-c statement_timeout=…) :
// une base lente ou bloquée renvoie une erreur au lieu d'accumuler les requêtes en attente.
func poolConfig(url string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(url, "pool_max_conns") {
		cfg.MaxConns = 10 // deux répliques : 20 connexions, loin des 100 de PostgreSQL
	}
	if cfg.ConnConfig.ConnectTimeout == 0 {
		cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["statement_timeout"]; !ok && !strings.Contains(url, "statement_timeout") {
		// Large : les collectes écrivent des dizaines de milliers de lignes en une requête.
		cfg.ConnConfig.RuntimeParams["statement_timeout"] = "60s"
	}
	return cfg, nil
}

// schemaLock sérialise l'application du schéma : deux répliques qui démarrent ensemble
// se bloqueraient sinon mutuellement (deadlock sur les CREATE … IF NOT EXISTS).
const schemaLock int64 = 0x7a656c6f + 1

func migrate(ctx context.Context, db *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		// Un ALTER TABLE attend que la table soit libre, et toutes les lectures attendent derrière lui :
		// plutôt échouer (le pod redémarre et réessaie) que figer l'API derrière une collecte en cours.
		if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '5s'`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, schemaLock); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, schema)
		return err
	})
}

func pingRetry(ctx context.Context, db *pgxpool.Pool, max time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, max)
	defer cancel()
	for wait := 250 * time.Millisecond; ; wait = min(2*wait, 4*time.Second) {
		err := db.Ping(ctx)
		if err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(wait):
		}
	}
}

func (s *Store) Close()                         { s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.Ping(ctx) }

// PoolStat : état du pool de connexions, exposé à Prometheus.
func (s *Store) PoolStat() *pgxpool.Stat { return s.db.Stat() }

// BBox en degrés WGS84.
type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

const envelope = `ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`

// center : centre de la zone demandée. Quand la limite coupe la liste, on garde les plus proches
// du centre de l'écran plutôt qu'un échantillon arbitraire.
const center = `ST_SetSRID(ST_MakePoint(($1 + $3) / 2, ($2 + $4) / 2), 4326)::geography`

// --- Écritures : COPY dans une table temporaire puis upsert, en une transaction.

func (s *Store) SaveFuel(ctx context.Context, stations []fuel.Station) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			CREATE TEMP TABLE tmp_station (id text, lon float8, lat float8, address text, city text, postcode text) ON COMMIT DROP;
			CREATE TEMP TABLE tmp_price (station_id text, fuel text, price numeric(6,3), updated_at timestamptz) ON COMMIT DROP;`); err != nil {
			return err
		}
		var prices [][]any
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_station"},
			[]string{"id", "lon", "lat", "address", "city", "postcode"},
			pgx.CopyFromSlice(len(stations), func(i int) ([]any, error) {
				st := stations[i]
				for _, p := range st.Prices {
					prices = append(prices, []any{st.ID, p.Fuel, p.Value, p.UpdatedAt})
				}
				return []any{st.ID, st.Lon, st.Lat, st.Address, st.City, st.Postcode}, nil
			})); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_price"},
			[]string{"station_id", "fuel", "price", "updated_at"}, pgx.CopyFromRows(prices)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO fuel_station (id, geom, address, city, postcode, seen_at)
			SELECT DISTINCT ON (id) id, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, address, city, postcode, now()
			FROM tmp_station
			ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, address = EXCLUDED.address,
				city = EXCLUDED.city, postcode = EXCLUDED.postcode, seen_at = now()
			-- Toutes les 10 min, ~10 000 stations inchangées : on ne réécrit une ligne que si elle change,
			-- ou une fois par jour pour seen_at (la purge à 7 jours n'a pas besoin de plus de précision).
			WHERE fuel_station.seen_at < now() - interval '1 day'
				OR ST_AsBinary(fuel_station.geom) IS DISTINCT FROM ST_AsBinary(EXCLUDED.geom)
				OR (fuel_station.address, fuel_station.city, fuel_station.postcode)
					IS DISTINCT FROM (EXCLUDED.address, EXCLUDED.city, EXCLUDED.postcode);

			DELETE FROM fuel_price p WHERE NOT EXISTS (
				SELECT 1 FROM tmp_price t WHERE t.station_id = p.station_id AND t.fuel = p.fuel);

			INSERT INTO fuel_price (station_id, fuel, price, updated_at)
			SELECT DISTINCT ON (station_id, fuel) station_id, fuel, price, updated_at
			FROM tmp_price ORDER BY station_id, fuel, updated_at DESC
			ON CONFLICT (station_id, fuel) DO UPDATE SET price = EXCLUDED.price, updated_at = EXCLUDED.updated_at
			WHERE fuel_price.updated_at IS DISTINCT FROM EXCLUDED.updated_at;

			DELETE FROM fuel_station WHERE seen_at < now() - interval '7 days';`)
		return err
	})
}

func (s *Store) SaveChargePoints(ctx context.Context, points []irve.ChargePoint) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE tmp_cp (
			id text, station_id text, station_name text, operator text, address text,
			lon float8, lat float8, power_kw real, sockets text[], free boolean, card_payment boolean, hours text,
			price_kwh real, price_from boolean) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_cp"},
			[]string{"id", "station_id", "station_name", "operator", "address", "lon", "lat", "power_kw", "sockets", "free", "card_payment", "hours", "price_kwh", "price_from"},
			pgx.CopyFromSlice(len(points), func(i int) ([]any, error) {
				p := points[i]
				var price *float32
				if p.PriceKWh != nil {
					v := float32(*p.PriceKWh)
					price = &v
				}
				return []any{p.ID, p.StationID, p.StationName, p.Operator, p.Address, p.Lon, p.Lat,
					float32(p.PowerKW), p.Sockets, p.Free, p.CardPayment, p.Hours, price, p.PriceFrom}, nil
			})); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO charge_point (id, station_id, station_name, operator, address, geom, power_kw, sockets, free, card_payment, hours, price_kwh, price_from, seen_at)
			SELECT id, station_id, station_name, operator, address, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
				power_kw, coalesce(sockets, '{}'), free, card_payment, hours, price_kwh, price_from, now()
			FROM tmp_cp
			ON CONFLICT (id) DO UPDATE SET station_id = EXCLUDED.station_id, station_name = EXCLUDED.station_name,
				operator = EXCLUDED.operator, address = EXCLUDED.address, geom = EXCLUDED.geom, power_kw = EXCLUDED.power_kw,
				sockets = EXCLUDED.sockets, free = EXCLUDED.free, card_payment = EXCLUDED.card_payment,
				hours = EXCLUDED.hours, price_kwh = EXCLUDED.price_kwh, price_from = EXCLUDED.price_from, seen_at = now();

			DELETE FROM charge_point WHERE seen_at < now() - interval '7 days';`)
		return err
	})
}

func (s *Store) SaveChargeStatus(ctx context.Context, statuses []irve.Status) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE tmp_cs (id text, state text, occupancy text, observed_at timestamptz) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_cs"}, []string{"id", "state", "occupancy", "observed_at"},
			pgx.CopyFromSlice(len(statuses), func(i int) ([]any, error) {
				st := statuses[i]
				return []any{st.ID, st.State, st.Occupancy, st.ObservedAt}, nil
			})); err != nil {
			return err
		}
		// Le flux est national (~90 000 points) : seuls les points connus (zone importée) sont gardés,
		// et les états de points disparus ou figés depuis une semaine sont effacés.
		_, err := tx.Exec(ctx, `
			INSERT INTO charge_status (id, state, occupancy, observed_at)
			SELECT DISTINCT ON (t.id) t.id, t.state, t.occupancy, t.observed_at
			FROM tmp_cs t JOIN charge_point c ON c.id = t.id
			ORDER BY t.id, t.observed_at DESC
			ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, occupancy = EXCLUDED.occupancy, observed_at = EXCLUDED.observed_at
			WHERE charge_status.observed_at < EXCLUDED.observed_at;

			DELETE FROM charge_status s
			WHERE s.observed_at < now() - interval '7 days'
				OR NOT EXISTS (SELECT 1 FROM charge_point c WHERE c.id = s.id);`)
		return err
	})
}

// SaveParkings remplace les parkings de la zone importée : un parking disparu d'OSM disparaît ici.
func (s *Store) SaveParkings(ctx context.Context, parkings []parking.Parking) error {
	if len(parkings) == 0 {
		return errors.New("aucun parking reçu : import ignoré pour ne pas vider la table")
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE tmp_pk (
			id text, name text, operator text, kind text, lon float8, lat float8, capacity int, disabled int,
			charging int, fee boolean, max_height real, opening_hours text, park_ride boolean) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_pk"},
			[]string{"id", "name", "operator", "kind", "lon", "lat", "capacity", "disabled", "charging", "fee", "max_height", "opening_hours", "park_ride"},
			pgx.CopyFromSlice(len(parkings), func(i int) ([]any, error) {
				p := parkings[i]
				var h *float32
				if p.MaxHeight != nil {
					v := float32(*p.MaxHeight)
					h = &v
				}
				return []any{p.ID, p.Name, p.Operator, p.Kind, p.Lon, p.Lat, p.Capacity, p.Disabled, p.Charging,
					p.Fee, h, p.OpeningHours, p.ParkRide}, nil
			})); err != nil {
			return err
		}
		// now() vaut l'heure de début de la transaction : tout ce qui n'a pas été vu dans cet import est supprimé.
		_, err := tx.Exec(ctx, `
			INSERT INTO parking (id, name, operator, kind, geom, capacity, disabled, charging, fee, max_height, opening_hours, park_ride, seen_at)
			SELECT DISTINCT ON (id) id, name, operator, kind, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
				capacity, disabled, charging, fee, max_height, opening_hours, park_ride, now()
			FROM tmp_pk
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, operator = EXCLUDED.operator, kind = EXCLUDED.kind,
				geom = EXCLUDED.geom, capacity = EXCLUDED.capacity, disabled = EXCLUDED.disabled, charging = EXCLUDED.charging,
				fee = EXCLUDED.fee, max_height = EXCLUDED.max_height, opening_hours = EXCLUDED.opening_hours,
				park_ride = EXCLUDED.park_ride, seen_at = now();

			DELETE FROM parking WHERE seen_at < now();`)
		return err
	})
}

// SaveControls remplace les feux et stops : comme pour les parkings, ce qui a disparu d'OSM disparaît.
func (s *Store) SaveControls(ctx context.Context, controls []junction.Control) error {
	if len(controls) == 0 {
		return errors.New("aucun feu ni stop reçu : import ignoré pour ne pas vider la table")
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE tmp_jc (id text, kind text, lon float8, lat float8) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_jc"}, []string{"id", "kind", "lon", "lat"},
			pgx.CopyFromSlice(len(controls), func(i int) ([]any, error) {
				c := controls[i]
				return []any{c.ID, c.Kind, c.Lon, c.Lat}, nil
			})); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			DELETE FROM junction_control j WHERE NOT EXISTS (SELECT 1 FROM tmp_jc t WHERE t.id = j.id);
			INSERT INTO junction_control (id, kind, geom)
			SELECT DISTINCT ON (id) id, kind, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography FROM tmp_jc
			ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, geom = EXCLUDED.geom
			WHERE (junction_control.kind, ST_AsBinary(junction_control.geom)) IS DISTINCT FROM (EXCLUDED.kind, ST_AsBinary(EXCLUDED.geom));`)
		return err
	})
}

// SaveAreas remplace les aires d'autoroute de la zone importée.
func (s *Store) SaveAreas(ctx context.Context, areas []servicearea.Area) error {
	if len(areas) == 0 {
		return errors.New("aucune aire reçue : import ignoré pour ne pas vider la table")
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE tmp_sa (id text, kind text, name text, operator text, ring text, lon float8, lat float8, services text[]) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_sa"}, []string{"id", "kind", "name", "operator", "ring", "lon", "lat", "services"},
			pgx.CopyFromSlice(len(areas), func(i int) ([]any, error) {
				a := areas[i]
				return []any{a.ID, a.Kind, a.Name, a.Operator, wktPolygon(a.Ring), a.Lon, a.Lat, a.Services}, nil
			})); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			DELETE FROM service_area a WHERE NOT EXISTS (SELECT 1 FROM tmp_sa t WHERE t.id = a.id);
			INSERT INTO service_area (id, kind, name, operator, geom, center, services)
			SELECT DISTINCT ON (id) id, kind, name, operator,
				-- ST_MakeValid : un contour OSM qui se recoupe reste exploitable.
				ST_MakeValid(ST_GeomFromText(ring, 4326))::geography,
				ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, services
			FROM tmp_sa
			WHERE ST_GeometryType(ST_MakeValid(ST_GeomFromText(ring, 4326))) = 'ST_Polygon'
			ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, operator = EXCLUDED.operator,
				geom = EXCLUDED.geom, center = EXCLUDED.center, services = EXCLUDED.services;`)
		return err
	})
}

func wktPolygon(ring [][2]float64) string {
	var b strings.Builder
	b.WriteString("POLYGON((")
	for i, p := range ring {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%.7f %.7f", p[0], p[1])
	}
	b.WriteString("))")
	return b.String()
}

// --- Lectures

// AreaOnRoute : une aire proche d'un tracé, avec les prix et les bornes de ce qu'elle contient.
type AreaOnRoute struct {
	ID, Kind, Name string
	Lat, Lon       float64
	Services       []string
	Fuel           map[string]float64
	ChargeTotal    int
	ChargeFree     int
	ChargeKnown    int // points avec un état publié depuis moins de 24 h
}

// AreasAlong : aires à moins de within mètres du tracé ([lon, lat]). Carburant : le prix le plus
// bas de chaque carburant aux stations de l'aire ; recharge : ses points et leur état.
func (s *Store) AreasAlong(ctx context.Context, line [][2]float64, within float64) ([]AreaOnRoute, error) {
	if len(line) < 2 {
		return nil, nil
	}
	lons, lats := make([]float64, len(line)), make([]float64, len(line))
	for i, p := range line {
		lons[i], lats[i] = p[0], p[1]
	}
	rows, err := s.db.Query(ctx, `
		WITH line AS (
			SELECT ST_Simplify(ST_MakeLine(ST_SetSRID(ST_MakePoint(lon, lat), 4326) ORDER BY ord), 0.00005)::geography AS g
			FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS p(lon, lat, ord)
		)
		SELECT a.id, a.kind, a.name, ST_Y(a.center::geometry), ST_X(a.center::geometry), a.services,
			coalesce((
				SELECT jsonb_object_agg(fuel, price) FROM (
					SELECT p.fuel, min(p.price)::float8 AS price
					FROM fuel_station f JOIN fuel_price p ON p.station_id = f.id
					WHERE ST_DWithin(f.geom, a.geom, 50) AND p.updated_at > now() - interval '7 days'
					GROUP BY p.fuel) x), '{}'),
			c.total, c.free, c.known
		FROM service_area a, line
		CROSS JOIN LATERAL (
			SELECT count(*) AS total,
				count(*) FILTER (WHERE st.occupancy = 'libre' AND st.state = 'en_service' AND st.observed_at > now() - interval '24 hours') AS free,
				count(st.id) FILTER (WHERE st.observed_at > now() - interval '24 hours') AS known
			FROM charge_point cp LEFT JOIN charge_status st ON st.id = cp.id
			WHERE ST_DWithin(cp.geom, a.geom, 30)) c
		WHERE ST_DWithin(a.geom, line.g, $3)`, lons, lats, within)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (AreaOnRoute, error) {
		var a AreaOnRoute
		err := r.Scan(&a.ID, &a.Kind, &a.Name, &a.Lat, &a.Lon, &a.Services, &a.Fuel, &a.ChargeTotal, &a.ChargeFree, &a.ChargeKnown)
		return a, err
	})
}

// Controls : feux et stops à moins de radius mètres d'un des points ([lon, lat]), les
// manœuvres d'un itinéraire : quelques lignes, même pour un long trajet.
func (s *Store) Controls(ctx context.Context, points [][2]float64, radius float64) ([]junction.Control, error) {
	if len(points) == 0 {
		return nil, nil
	}
	lons, lats := make([]float64, len(points)), make([]float64, len(points))
	for i, p := range points {
		lons[i], lats[i] = p[0], p[1]
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT j.id, j.kind, ST_Y(j.geom::geometry), ST_X(j.geom::geometry)
		FROM unnest($1::float8[], $2::float8[]) AS p(lon, lat)
		JOIN junction_control j ON ST_DWithin(j.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, $3)`,
		lons, lats, radius)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[junction.Control])
}

type FuelStation struct {
	ID      string             `json:"id"`
	Lat     float64            `json:"lat"`
	Lon     float64            `json:"lon"`
	Address string             `json:"address"`
	City    string             `json:"city"`
	Prices  map[string]float64 `json:"prices"`
	// UpdatedAt est la mise à jour de prix la plus récente de la station.
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Store) FuelStations(ctx context.Context, b BBox, limit int) ([]FuelStation, error) {
	rows, err := s.db.Query(ctx, `
		SELECT s.id, ST_Y(s.geom::geometry), ST_X(s.geom::geometry), s.address, s.city,
			coalesce(jsonb_object_agg(p.fuel, p.price) FILTER (WHERE p.fuel IS NOT NULL), '{}'),
			coalesce(max(p.updated_at), s.seen_at)
		FROM fuel_station s LEFT JOIN fuel_price p ON p.station_id = s.id
		WHERE ST_Intersects(s.geom, `+envelope+`)
		GROUP BY s.id
		ORDER BY s.geom <-> `+center+`
		LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (FuelStation, error) {
		var f FuelStation
		err := r.Scan(&f.ID, &f.Lat, &f.Lon, &f.Address, &f.City, &f.Prices, &f.UpdatedAt)
		return f, err
	})
}

// ChargeStation regroupe les points de charge d'une même station.
type ChargeStation struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Operator   string   `json:"operator"`
	Lat        float64  `json:"lat"`
	Lon        float64  `json:"lon"`
	MaxPowerKW float32  `json:"maxPowerKw"`
	Sockets    []string `json:"sockets"`
	Total      int      `json:"total"`
	// Available est nil quand aucun état récent (moins de 24 h) n'est publié.
	Available  *int       `json:"available"`
	ObservedAt *time.Time `json:"observedAt"`
	// Price : prix au kWh annoncé par l'opérateur, nil s'il n'est pas publié lisiblement.
	Price *ChargePrice `json:"price"`
}

type ChargePrice struct {
	// Free : tous les points de la station sont déclarés gratuits.
	Free bool    `json:"free"`
	KWh  float32 `json:"kwh"` // euros, le moins cher de la station
	// From : d'autres frais s'ajoutent, ou le prix varie selon le point : « dès … ».
	From bool `json:"from"`
}

func (s *Store) ChargeStations(ctx context.Context, b BBox, limit int) ([]ChargeStation, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.station_id, max(c.station_name), max(c.operator),
			ST_Y(ST_Centroid(ST_Collect(c.geom::geometry))), ST_X(ST_Centroid(ST_Collect(c.geom::geometry))),
			max(c.power_kw),
			(SELECT coalesce(array_agg(DISTINCT x), '{}') FROM charge_point c2, unnest(c2.sockets) AS x WHERE c2.station_id = c.station_id),
			count(*),
			count(*) FILTER (WHERE st.occupancy = 'libre' AND st.state = 'en_service' AND st.observed_at > now() - interval '24 hours'),
			count(st.id) FILTER (WHERE st.observed_at > now() - interval '24 hours'),
			max(st.observed_at),
			bool_and(c.free), min(c.price_kwh), bool_or(c.price_from) OR count(DISTINCT c.price_kwh) > 1
		FROM charge_point c
		LEFT JOIN charge_status st ON st.id = c.id
		WHERE ST_Intersects(c.geom, `+envelope+`)
		GROUP BY c.station_id
		ORDER BY min(c.geom <-> `+center+`)
		LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ChargeStation, error) {
		var c ChargeStation
		var free, withStatus int
		var allFree, priceFrom bool
		var price *float32
		err := r.Scan(&c.ID, &c.Name, &c.Operator, &c.Lat, &c.Lon, &c.MaxPowerKW, &c.Sockets, &c.Total, &free, &withStatus, &c.ObservedAt,
			&allFree, &price, &priceFrom)
		if withStatus > 0 {
			c.Available = &free
		}
		switch {
		case allFree:
			c.Price = &ChargePrice{Free: true}
		case price != nil:
			c.Price = &ChargePrice{KWh: *price, From: priceFrom}
		}
		return c, err
	})
}

type Parking struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Operator     string   `json:"operator"`
	Kind         string   `json:"kind"`
	Lat          float64  `json:"lat"`
	Lon          float64  `json:"lon"`
	Capacity     *int     `json:"capacity"`
	Disabled     *int     `json:"disabled"`
	Charging     *int     `json:"charging"`
	Fee          *bool    `json:"fee"`
	MaxHeight    *float32 `json:"maxHeight"`
	OpeningHours string   `json:"openingHours"`
	ParkRide     bool     `json:"parkRide"`
}

// Parkings renvoie les plus grands d'abord, pour qu'une limite atteinte coupe les petits.
func (s *Store) Parkings(ctx context.Context, b BBox, limit int) ([]Parking, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, operator, kind, ST_Y(geom::geometry), ST_X(geom::geometry),
			capacity, disabled, charging, fee, max_height, opening_hours, park_ride
		FROM parking
		WHERE ST_Intersects(geom, `+envelope+`)
		ORDER BY capacity DESC NULLS LAST
		LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Parking])
}

// --- Signalements

func (s *Store) PurgeReports(ctx context.Context) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM report WHERE expires_at < now() - interval '1 day'`)
	return tag.RowsAffected(), err
}
