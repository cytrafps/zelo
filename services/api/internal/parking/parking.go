// Package parking lit les parkings publics d'OpenStreetMap via l'API Overpass
// (données © contributeurs OpenStreetMap, licence ODbL).
//
// La base nationale des lieux de stationnement (transport.data.gouv.fr) ne contient
// aucun parking à Reims ; OSM est aujourd'hui la source la plus complète.
package parking

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// OverpassURL est l'instance publique ; à remplacer par une instance dédiée en production.
const OverpassURL = overpass.URL

type BBox = overpass.BBox

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
	return `[out:json][timeout:90];nwr["amenity"="parking"]` + b.Filter() + `;out center tags;`
}

// Fetch interroge Overpass pour la zone donnée.
func Fetch(ctx context.Context, client *http.Client, endpoint string, b BBox) ([]Parking, error) {
	if b == (BBox{}) {
		return nil, fmt.Errorf("zone d'import obligatoire : Overpass ne sert pas la France entière")
	}
	els, err := overpass.Fetch(ctx, client, endpoint, Query(b))
	if err != nil {
		return nil, err
	}
	return fromElements(els), nil
}

// Parse lit une réponse Overpass JSON et ne garde que les parkings utiles à un conducteur.
func Parse(r io.Reader) ([]Parking, error) {
	els, err := overpass.Parse(r)
	if err != nil {
		return nil, err
	}
	return fromElements(els), nil
}

func fromElements(els []overpass.Element) []Parking {
	out := make([]Parking, 0, len(els))
	for _, e := range els {
		if p, ok := toParking(e); ok {
			out = append(out, p)
		}
	}
	return out
}

// Accès qui excluent le grand public : propriétaires, abonnés, clients d'un commerce, livraisons.
var closedAccess = map[string]bool{"private": true, "no": true, "permit": true, "customers": true, "delivery": true}

func toParking(e overpass.Element) (Parking, bool) {
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
