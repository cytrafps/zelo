// Package store persiste les données dans PostgreSQL + PostGIS.
package store

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cytrafps/zelo/services/api/internal/fuel"
	"github.com/cytrafps/zelo/services/api/internal/irve"
	"github.com/cytrafps/zelo/services/api/internal/parking"
)

//go:embed schema.sql
var schema string

type Store struct{ db *pgxpool.Pool }

// Open attend la base jusqu'à 30 s : au démarrage d'un conteneur ou d'un pod,
// PostgreSQL peut encore être en train de s'initialiser.
func Open(ctx context.Context, url string) (*Store, error) {
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pingRetry(ctx, db, 30*time.Second); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(ctx, schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("schéma: %w", err)
	}
	return &Store{db: db}, nil
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

// BBox en degrés WGS84.
type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

const envelope = `ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`

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
				city = EXCLUDED.city, postcode = EXCLUDED.postcode, seen_at = now();

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
			lon float8, lat float8, power_kw real, sockets text[], free boolean, card_payment boolean, hours text) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_cp"},
			[]string{"id", "station_id", "station_name", "operator", "address", "lon", "lat", "power_kw", "sockets", "free", "card_payment", "hours"},
			pgx.CopyFromSlice(len(points), func(i int) ([]any, error) {
				p := points[i]
				return []any{p.ID, p.StationID, p.StationName, p.Operator, p.Address, p.Lon, p.Lat,
					float32(p.PowerKW), p.Sockets, p.Free, p.CardPayment, p.Hours}, nil
			})); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO charge_point (id, station_id, station_name, operator, address, geom, power_kw, sockets, free, card_payment, hours, seen_at)
			SELECT id, station_id, station_name, operator, address, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
				power_kw, coalesce(sockets, '{}'), free, card_payment, hours, now()
			FROM tmp_cp
			ON CONFLICT (id) DO UPDATE SET station_id = EXCLUDED.station_id, station_name = EXCLUDED.station_name,
				operator = EXCLUDED.operator, address = EXCLUDED.address, geom = EXCLUDED.geom, power_kw = EXCLUDED.power_kw,
				sockets = EXCLUDED.sockets, free = EXCLUDED.free, card_payment = EXCLUDED.card_payment,
				hours = EXCLUDED.hours, seen_at = now();

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
		_, err := tx.Exec(ctx, `
			INSERT INTO charge_status (id, state, occupancy, observed_at)
			SELECT id, state, occupancy, observed_at FROM tmp_cs
			ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, occupancy = EXCLUDED.occupancy, observed_at = EXCLUDED.observed_at
			WHERE charge_status.observed_at < EXCLUDED.observed_at`)
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

// --- Lectures

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
			max(st.observed_at)
		FROM charge_point c
		LEFT JOIN charge_status st ON st.id = c.id
		WHERE ST_Intersects(c.geom, `+envelope+`)
		GROUP BY c.station_id
		LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ChargeStation, error) {
		var c ChargeStation
		var free, withStatus int
		err := r.Scan(&c.ID, &c.Name, &c.Operator, &c.Lat, &c.Lon, &c.MaxPowerKW, &c.Sockets, &c.Total, &free, &withStatus, &c.ObservedAt)
		if withStatus > 0 {
			c.Available = &free
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

type Report struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Lat       float64   `json:"lat"`
	Lon       float64   `json:"lon"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (s *Store) AddReport(ctx context.Context, kind string, lat, lon float64, ttl time.Duration) (Report, error) {
	r := Report{Kind: kind, Lat: lat, Lon: lon}
	err := s.db.QueryRow(ctx, `
		INSERT INTO report (kind, geom, expires_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, now() + make_interval(secs => $4))
		RETURNING id, created_at, expires_at`, kind, lat, lon, ttl.Seconds()).Scan(&r.ID, &r.CreatedAt, &r.ExpiresAt)
	return r, err
}

func (s *Store) Reports(ctx context.Context, b BBox, limit int) ([]Report, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, kind, ST_Y(geom::geometry), ST_X(geom::geometry), created_at, expires_at
		FROM report
		WHERE expires_at > now() AND ST_Intersects(geom, `+envelope+`)
		ORDER BY created_at DESC LIMIT $5`, b.MinLon, b.MinLat, b.MaxLon, b.MaxLat, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Report])
}

func (s *Store) PurgeReports(ctx context.Context) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM report WHERE expires_at < now() - interval '1 day'`)
	return tag.RowsAffected(), err
}
