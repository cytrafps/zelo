// Package irve lit les bornes de recharge consolidées par transport.data.gouv.fr
// (schéma IRVE statique et dynamique, Licence Ouverte 2.0).
package irve

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	StaticURL  = "https://proxy.transport.data.gouv.fr/resource/consolidation-transport-irve-statique"
	DynamicURL = "https://proxy.transport.data.gouv.fr/resource/consolidation-nationale-irve-dynamique"
)

// ChargePoint est un point de charge (une prise utilisable par un véhicule à la fois).
type ChargePoint struct {
	ID          string // id_pdc_itinerance
	StationID   string
	StationName string
	Operator    string
	Address     string
	Lat, Lon    float64
	PowerKW     float64
	Sockets     []string // type2, ccs, chademo, ef, autre
	Free        bool
	CardPayment bool
	Hours       string
	// PriceKWh : prix annoncé en euros par kWh, nil s'il n'est pas publié lisiblement.
	PriceKWh *float64
	// PriceFrom : d'autres frais (minute, session) s'ajoutent au kWh.
	PriceFrom bool
	// Reserved : « Accès réservé » (clients d'un hôtel, d'une concession, flotte…).
	Reserved bool
	// PMR : « accessible », « réservé » (aux PMR), « non » ou « » (inconnu).
	PMR string
	// MaxHeight : hauteur maximale (m) quand elle est publiée lisiblement, sinon nil.
	MaxHeight *float64
	// TwoWheels : point adapté aux deux-roues (scooters, motos électriques).
	TwoWheels bool
	// Placement : « voirie », « parking », « parking-clients » ou « recharge-rapide ».
	Placement string
	// Bookable : le point se réserve à l'avance.
	Bookable bool
}

// Status est l'état d'un point de charge à un instant donné.
type Status struct {
	ID         string
	State      string // en_service, hors_service, inconnu
	Occupancy  string // libre, occupe, reserve, inconnu
	ObservedAt time.Time
}

// BBox limite l'import à une zone (minLon, minLat, maxLon, maxLat). Zéro = toute la France.
type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

func (b BBox) contains(lon, lat float64) bool {
	if b == (BBox{}) {
		return true
	}
	return lon >= b.MinLon && lon <= b.MaxLon && lat >= b.MinLat && lat <= b.MaxLat
}

func get(ctx context.Context, client *http.Client, url string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("irve: HTTP %d pour %s", resp.StatusCode, url)
	}
	return resp.Body, nil
}

func FetchStatic(ctx context.Context, client *http.Client, url string, bbox BBox) ([]ChargePoint, error) {
	body, err := get(ctx, client, url)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return ParseStatic(body, bbox)
}

func FetchDynamic(ctx context.Context, client *http.Client, url string) ([]Status, error) {
	body, err := get(ctx, client, url)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	return ParseDynamic(body)
}

// columns associe le nom de colonne à son index, pour ne pas dépendre de l'ordre.
type columns map[string]int

func (c columns) get(rec []string, name string) string {
	if i, ok := c[name]; ok && i < len(rec) {
		return strings.TrimSpace(rec[i])
	}
	return ""
}

func readHeader(r *csv.Reader, required ...string) (columns, error) {
	h, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("irve: en-tête: %w", err)
	}
	cols := make(columns, len(h))
	for i, name := range h {
		cols[strings.TrimPrefix(strings.TrimSpace(name), "\ufeff")] = i
	}
	for _, name := range required {
		if _, ok := cols[name]; !ok {
			return nil, fmt.Errorf("irve: colonne %q absente", name)
		}
	}
	return cols, nil
}

func newReader(r io.Reader) *csv.Reader {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	cr.ReuseRecord = true
	return cr
}

// ParseStatic lit le CSV statique consolidé et dédoublonne par id_pdc_itinerance.
func ParseStatic(r io.Reader, bbox BBox) ([]ChargePoint, error) {
	cr := newReader(r)
	cols, err := readHeader(cr, "id_pdc_itinerance", "id_station_itinerance", "coordonneesXY")
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, 1<<17)
	out := make([]ChargePoint, 0, 1<<14)
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("irve: csv: %w", err)
		}
		id := cols.get(rec, "id_pdc_itinerance")
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		lon, lat, ok := position(cols, rec)
		if !ok || !bbox.contains(lon, lat) {
			continue
		}
		seen[id] = struct{}{}
		power, _ := strconv.ParseFloat(cols.get(rec, "puissance_nominale"), 64)
		var price *float64
		v, from, ok := parsePrice(cols.get(rec, "tarification"))
		if ok {
			price = &v
		}
		out = append(out, ChargePoint{
			ID:          id,
			StationID:   cols.get(rec, "id_station_itinerance"),
			StationName: cols.get(rec, "nom_station"),
			Operator:    firstNonEmpty(cols.get(rec, "nom_enseigne"), cols.get(rec, "nom_operateur")),
			Address:     cols.get(rec, "adresse_station"),
			Lat:         lat,
			Lon:         lon,
			PowerKW:     normalizePower(power),
			Sockets:     sockets(cols, rec),
			Free:        isTrue(cols.get(rec, "gratuit")),
			CardPayment: isTrue(cols.get(rec, "paiement_cb")),
			Hours:       cols.get(rec, "horaires"),
			PriceKWh:    price,
			PriceFrom:   from,
			Reserved:    cols.get(rec, "condition_acces") == "Accès réservé",
			PMR:         pmr(cols.get(rec, "accessibilite_pmr")),
			MaxHeight:   maxHeight(cols.get(rec, "restriction_gabarit")),
			TwoWheels:   isTrue(cols.get(rec, "station_deux_roues")),
			Placement:   placement(cols.get(rec, "implantation_station")),
			Bookable:    isTrue(cols.get(rec, "reservation")),
		})
	}
}

// ParseDynamic lit le CSV dynamique (état et occupation par point de charge).
func ParseDynamic(r io.Reader) ([]Status, error) {
	cr := newReader(r)
	cols, err := readHeader(cr, "id_pdc_itinerance", "etat_pdc", "occupation_pdc", "horodatage")
	if err != nil {
		return nil, err
	}
	latest := make(map[string]Status, 1<<17)
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("irve: csv: %w", err)
		}
		id := cols.get(rec, "id_pdc_itinerance")
		t, ok := parseTime(cols.get(rec, "horodatage"))
		if id == "" || !ok {
			continue
		}
		if prev, dup := latest[id]; dup && !t.After(prev.ObservedAt) {
			continue
		}
		latest[id] = Status{
			ID:         id,
			State:      orUnknown(cols.get(rec, "etat_pdc")),
			Occupancy:  orUnknown(cols.get(rec, "occupation_pdc")),
			ObservedAt: t,
		}
	}
	out := make([]Status, 0, len(latest))
	for _, s := range latest {
		out = append(out, s)
	}
	return out, nil
}

func position(cols columns, rec []string) (lon, lat float64, ok bool) {
	// Coordonnées corrigées par la consolidation si disponibles, sinon le champ brut "[lon, lat]".
	if cols.get(rec, "consolidated_is_lon_lat_correct") != "False" {
		lon, err1 := strconv.ParseFloat(cols.get(rec, "consolidated_longitude"), 64)
		lat, err2 := strconv.ParseFloat(cols.get(rec, "consolidated_latitude"), 64)
		if err1 == nil && err2 == nil && valid(lon, lat) {
			return lon, lat, true
		}
	}
	xy := strings.Trim(cols.get(rec, "coordonneesXY"), "[] ")
	parts := strings.Split(xy, ",")
	if len(parts) != 2 {
		return 0, 0, false
	}
	lon, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	lat, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err1 != nil || err2 != nil || !valid(lon, lat) {
		return 0, 0, false
	}
	return lon, lat, true
}

func valid(lon, lat float64) bool {
	return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 && !(lon == 0 && lat == 0)
}

// normalizePower corrige les puissances saisies en watts au lieu de kW.
func normalizePower(p float64) float64 {
	if p > 1000 {
		return p / 1000
	}
	return p
}

func sockets(cols columns, rec []string) []string {
	var s []string
	for _, k := range [...]struct{ col, name string }{
		{"prise_type_2", "type2"},
		{"prise_type_combo_ccs", "ccs"},
		{"prise_type_chademo", "chademo"},
		{"prise_type_ef", "ef"},
		{"prise_type_autre", "autre"},
	} {
		if isTrue(cols.get(rec, k.col)) {
			s = append(s, k.name)
		}
	}
	return s
}

func isTrue(s string) bool {
	switch strings.ToLower(s) {
	case "true", "1", "vrai", "oui":
		return true
	}
	return false
}

func orUnknown(s string) string {
	if s == "" {
		return "inconnu"
	}
	return s
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func parseTime(s string) (time.Time, bool) {
	for _, layout := range [...]string{
		"2006-01-02 15:04:05.999999-07:00",
		"2006-01-02 15:04:05-07:00",
		time.RFC3339Nano,
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}
