// Package route calcule les itinéraires avec Valhalla, auto-hébergé à côté de l'API.
//
// L'API ne fait que relayer : elle impose la langue, l'unité et la distance maximale
// d'accroche (search_cutoff), puis renvoie une forme compacte à l'app.
package route

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Mode de déplacement : en voiture jusqu'au parking, à pied jusqu'à la destination.
type Mode string

const (
	Car  Mode = "auto"
	Walk Mode = "pedestrian"
)

// SearchCutoff est la distance maximale (m) entre un point demandé et la route la plus proche.
// Sans elle, Valhalla accroche en silence une destination hors des données au bord de la carte
// (Laon donnait un trajet qui s'arrêtait à 22 km de la ville).
const SearchCutoff = 500

var (
	ErrOutOfArea = errors.New("point hors de la zone couverte")
	ErrNoRoute   = errors.New("aucun itinéraire entre ces deux points")
)

type Point struct{ Lat, Lon float64 }

type Step struct {
	Instruction string  `json:"instruction"`
	Street      string  `json:"street,omitempty"`
	Type        int     `json:"type"`     // type de manœuvre Valhalla (virage, rond-point, arrivée…)
	Distance    float64 `json:"distance"` // mètres
	Duration    float64 `json:"duration"` // secondes
	Shape       int     `json:"shape"`    // index du premier point de la manœuvre dans Coordinates
}

type Route struct {
	Distance    float64      `json:"distance"` // mètres
	Duration    float64      `json:"duration"` // secondes
	Coordinates [][2]float64 `json:"coordinates"`
	Steps       []Step       `json:"steps"`
}

type Client struct {
	base string
	http *http.Client
}

func New(baseURL string) *Client {
	return &Client{base: baseURL, http: &http.Client{Timeout: 5 * time.Second}}
}

type location struct {
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
	SearchCutoff int     `json:"search_cutoff"`
}

type request struct {
	Locations  []location `json:"locations"`
	Costing    Mode       `json:"costing"`
	Directions struct {
		Language string `json:"language"`
		Units    string `json:"units"`
	} `json:"directions_options"`
}

type response struct {
	Trip struct {
		Summary struct {
			Length float64 `json:"length"` // km
			Time   float64 `json:"time"`   // s
		} `json:"summary"`
		Legs []struct {
			Shape     string `json:"shape"`
			Maneuvers []struct {
				Type        int      `json:"type"`
				Instruction string   `json:"instruction"`
				StreetNames []string `json:"street_names"`
				Length      float64  `json:"length"` // km
				Time        float64  `json:"time"`
				BeginShape  int      `json:"begin_shape_index"`
			} `json:"maneuvers"`
		} `json:"legs"`
	} `json:"trip"`
	ErrorCode int    `json:"error_code"`
	Error     string `json:"error"`
}

// Route calcule l'itinéraire de from à to.
func (c *Client) Route(ctx context.Context, from, to Point, mode Mode) (Route, error) {
	var req request
	req.Locations = []location{{from.Lat, from.Lon, SearchCutoff}, {to.Lat, to.Lon, SearchCutoff}}
	req.Costing = mode
	req.Directions.Language = "fr-FR"
	req.Directions.Units = "kilometers"
	body, _ := json.Marshal(req)

	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/route", bytes.NewReader(body))
	if err != nil {
		return Route{}, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(hreq)
	if err != nil {
		return Route{}, fmt.Errorf("valhalla: %w", err)
	}
	defer res.Body.Close()

	var out response
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&out); err != nil {
		return Route{}, fmt.Errorf("valhalla: réponse illisible (HTTP %d): %w", res.StatusCode, err)
	}
	if res.StatusCode != http.StatusOK {
		switch out.ErrorCode {
		case 170, 171: // aucune route à moins de search_cutoff
			return Route{}, ErrOutOfArea
		case 442: // points accrochés mais non reliés
			return Route{}, ErrNoRoute
		}
		return Route{}, fmt.Errorf("valhalla: HTTP %d, erreur %d: %s", res.StatusCode, out.ErrorCode, out.Error)
	}

	r := Route{Distance: out.Trip.Summary.Length * 1000, Duration: out.Trip.Summary.Time}
	for _, leg := range out.Trip.Legs {
		offset := len(r.Coordinates)
		pts, err := decodePolyline6(leg.Shape)
		if err != nil {
			return Route{}, fmt.Errorf("valhalla: tracé: %w", err)
		}
		r.Coordinates = append(r.Coordinates, pts...)
		for _, m := range leg.Maneuvers {
			s := Step{Instruction: m.Instruction, Type: m.Type, Distance: m.Length * 1000, Duration: m.Time, Shape: offset + m.BeginShape}
			if len(m.StreetNames) > 0 {
				s.Street = m.StreetNames[0]
			}
			r.Steps = append(r.Steps, s)
		}
	}
	return r, nil
}

// decodePolyline6 décode le tracé de Valhalla (polyline Google, précision 1e-6) en [lon, lat].
func decodePolyline6(s string) ([][2]float64, error) {
	var pts [][2]float64
	var lat, lon int
	for i := 0; i < len(s); {
		var d [2]int
		for k := range d {
			shift, v := 0, 0
			for {
				if i >= len(s) {
					return nil, errors.New("tracé tronqué")
				}
				b := int(s[i]) - 63
				i++
				v |= (b & 0x1f) << shift
				shift += 5
				if b < 0x20 {
					break
				}
			}
			if v&1 != 0 {
				d[k] = ^(v >> 1)
			} else {
				d[k] = v >> 1
			}
		}
		lat += d[0]
		lon += d[1]
		pts = append(pts, [2]float64{float64(lon) / 1e6, float64(lat) / 1e6})
	}
	return pts, nil
}
