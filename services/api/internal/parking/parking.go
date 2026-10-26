// Package parking lit les parkings publics d'OpenStreetMap via l'API Overpass
// (données © contributeurs OpenStreetMap, licence ODbL).
//
// La base nationale des lieux de stationnement (transport.data.gouv.fr) ne contient
// aucun parking à Reims ; OSM est aujourd'hui la source la plus complète.
package parking

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// OverpassURL est l'instance publique ; à remplacer par une instance dédiée en production.
const OverpassURL = "https://overpass-api.de/api/interpreter"

// userAgent identifie le projet, comme le demande la politique d'usage d'Overpass.
const userAgent = "zelo/0.1 (+https://github.com/cytrafps/zelo)"

type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

type Parking struct {
	ID           string // « way/123 », « node/456 », « relation/789 »
	Name         string
	Operator     string
	Kind         string // surface, multi-storey, underground, street
	Lat, Lon     float64
	Capacity     *int
	Disabled     *int
	Charging     *int
	Fee          *bool    // nil : non renseigné
	MaxHeight    *float64 // en mètres
	OpeningHours string
	ParkRide     bool
}

// Query renvoie la requête Overpass QL des parkings de la zone.
func Query(b BBox) string {
	return fmt.Sprintf(`[out:json][timeout:90];nwr["amenity"="parking"](%g,%g,%g,%g);out center tags;`,
		b.MinLat, b.MinLon, b.MaxLat, b.MaxLon)
}

// Fetch interroge Overpass pour la zone donnée.
func Fetch(ctx context.Context, client *http.Client, endpoint string, b BBox) ([]Parking, error) {
	if b == (BBox{}) {
		return nil, fmt.Errorf("zone d'import obligatoire : Overpass ne sert pas la France entière")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(url.Values{"data": {Query(b)}}.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil, fmt.Errorf("overpass: HTTP %d", resp.StatusCode)
	}
	return Parse(resp.Body)
}

type element struct {
	Type   string                      `json:"type"`
	ID     int64                       `json:"id"`
	Lat    float64                     `json:"lat"`
	Lon    float64                     `json:"lon"`
	Center *struct{ Lat, Lon float64 } `json:"center"`
	Tags   map[string]string           `json:"tags"`
}

// Parse lit une réponse Overpass JSON et ne garde que les parkings utiles à un conducteur.
func Parse(r io.Reader) ([]Parking, error) {
	var body struct {
		Remark   string    `json:"remark"`
		Elements []element `json:"elements"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return nil, fmt.Errorf("overpass: %w", err)
	}
	// Overpass répond 200 avec une remarque quand la requête a expiré : réponse incomplète.
	if strings.Contains(body.Remark, "runtime error") {
		return nil, fmt.Errorf("overpass: %s", body.Remark)
	}
	out := make([]Parking, 0, len(body.Elements))
	for _, e := range body.Elements {
		if p, ok := toParking(e); ok {
			out = append(out, p)
		}
	}
	return out, nil
}

// Accès qui excluent le grand public : propriétaires, abonnés, clients d'un commerce, livraisons.
var closedAccess = map[string]bool{"private": true, "no": true, "permit": true, "customers": true, "delivery": true}

func toParking(e element) (Parking, bool) {
	t := e.Tags
	if t["amenity"] != "parking" || closedAccess[t["access"]] {
		return Parking{}, false
	}
	lat, lon := e.Lat, e.Lon
	if e.Center != nil {
		lat, lon = e.Center.Lat, e.Center.Lon
	}
	if lat == 0 && lon == 0 {
		return Parking{}, false
	}
	p := Parking{
		ID:           e.Type + "/" + strconv.FormatInt(e.ID, 10),
		Name:         t["name"],
		Operator:     t["operator"],
		Kind:         kind(t["parking"]),
		Lat:          lat,
		Lon:          lon,
		Capacity:     count(t["capacity"]),
		Disabled:     count(t["capacity:disabled"]),
		Charging:     count(t["capacity:charging"]),
		Fee:          yesNo(t["fee"]),
		MaxHeight:    meters(t["maxheight"]),
		OpeningHours: t["opening_hours"],
		ParkRide:     t["park_ride"] != "" && t["park_ride"] != "no",
	}
	// Les petites aires sans nom (cours d'immeuble, bas-côtés) noient la carte sans aider.
	big := p.Capacity != nil && *p.Capacity >= 20
	if p.Name == "" && !big && !p.ParkRide && p.Kind != "multi-storey" && p.Kind != "underground" {
		return Parking{}, false
	}
	return p, true
}

func kind(v string) string {
	switch v {
	case "multi-storey", "rooftop":
		return "multi-storey"
	case "underground":
		return "underground"
	case "street_side", "lane", "on_kerb", "half_on_kerb":
		return "street"
	default:
		return "surface"
	}
}

// count accepte seulement un entier positif : « ~100 » ou « 50-60 » ne sont pas des valeurs fiables.
func count(v string) *int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 {
		return nil
	}
	return &n
}

func yesNo(v string) *bool {
	switch v {
	case "yes":
		b := true
		return &b
	case "no":
		b := false
		return &b
	}
	return nil
}

var metersRe = regexp.MustCompile(`^\s*(\d+(?:[.,]\d+)?)\s*(?:m)?\s*$`)

// meters lit « 2.1 », « 2,10 m », « 1.9m » ; ignore les valeurs impériales ou symboliques (« default »).
func meters(v string) *float64 {
	m := metersRe.FindStringSubmatch(v)
	if m == nil {
		return nil
	}
	f, err := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
	if err != nil || f <= 0 || f > 10 {
		return nil
	}
	return &f
}
