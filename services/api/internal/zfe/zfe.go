// Package zfe lit la Base nationale consolidée des zones à faibles émissions (transport.data.gouv.fr) :
// périmètre de chaque ZFE et vignettes Crit'Air interdites, par type de véhicule.
package zfe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// FeedURL : aires de la base nationale (GeoJSON, environ 2 Mo), publiées sur data.gouv.fr.
const FeedURL = "https://www.data.gouv.fr/api/1/datasets/r/673a16bf-49ec-4645-9da2-cf975d0aa0ea"

// BBox : zone retenue, en degrés.
type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

// Rule : à partir de quelle vignette la circulation est interdite (« V4 » : Crit'Air 4, 5 et sans
// vignette ; ordre EL, V1…V5, NC) et quand (horaires au format opening_hours d'OSM).
type Rule struct {
	Banned string `json:"banned"`
	Hours  string `json:"hours,omitempty"`
}

// Zone : une aire de ZFE en vigueur du From au To (AAAA-MM-JJ, inclus).
type Zone struct {
	ID    string           `json:"id"`
	Name  string           `json:"name"`
	From  string           `json:"from"`
	To    string           `json:"to,omitempty"`
	URL   string           `json:"url,omitempty"`
	Car   *Rule            `json:"car,omitempty"`  // véhicules particuliers
	Moto  *Rule            `json:"moto,omitempty"` // deux-roues motorisés
	Rings [][][][2]float64 `json:"polygons"`       // multipolygone [lon, lat]
}

// Fetch télécharge la base et garde les aires qui touchent la zone.
func Fetch(ctx context.Context, client *http.Client, url string, zone BBox) ([]Zone, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("zfe: HTTP %d", res.StatusCode)
	}
	return Parse(io.LimitReader(res.Body, 64<<20), zone)
}

var names = map[string]string{"200067213": "ZFE du Grand Reims"}

// Parse lit le GeoJSON de la base nationale.
func Parse(r io.Reader, zone BBox) ([]Zone, error) {
	var fc struct {
		Features []struct {
			Properties map[string]any `json:"properties"`
			Geometry   struct {
				Type        string          `json:"type"`
				Coordinates json.RawMessage `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if err := json.NewDecoder(r).Decode(&fc); err != nil {
		return nil, fmt.Errorf("zfe: %w", err)
	}
	var out []Zone
	for _, f := range fc.Features {
		var rings [][][][2]float64
		switch f.Geometry.Type {
		case "MultiPolygon":
			_ = json.Unmarshal(f.Geometry.Coordinates, &rings)
		case "Polygon":
			var p [][][2]float64
			if json.Unmarshal(f.Geometry.Coordinates, &p) == nil {
				rings = [][][][2]float64{p}
			}
		}
		if len(rings) == 0 || !touches(rings, zone) {
			continue
		}
		p := f.Properties
		z := Zone{ID: str(p["id"]), From: str(p["date_debut"]), To: str(p["date_fin"]), URL: str(p["url_site_information"]), Rings: rings}
		z.Name = names[strings.SplitN(z.ID, "-", 2)[0]]
		if z.Name == "" {
			z.Name = "Zone à faibles émissions"
		}
		z.Car = rule(p["vp_critair"], p["vp_horaires"])
		z.Moto = rule(p["deux_rm_critair"], p["deux_rm_horaires"])
		out = append(out, z)
	}
	return out, nil
}

var critair = map[string]bool{"EL": true, "V1": true, "V2": true, "V3": true, "V4": true, "V5": true, "NC": true}

func rule(banned, hours any) *Rule {
	b := strings.ToUpper(strings.TrimSpace(str(banned)))
	if !critair[b] {
		return nil // pas de restriction pour ce véhicule
	}
	return &Rule{Banned: b, Hours: strings.TrimSpace(str(hours))}
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func touches(rings [][][][2]float64, b BBox) bool {
	for _, poly := range rings {
		for _, ring := range poly {
			for _, p := range ring {
				if p[0] >= b.MinLon && p[0] <= b.MaxLon && p[1] >= b.MinLat && p[1] <= b.MaxLat {
					return true
				}
			}
		}
	}
	return false
}
