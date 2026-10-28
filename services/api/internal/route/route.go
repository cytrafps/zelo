// Package route calcule les itinéraires avec Valhalla, auto-hébergé à côté de l'API.
//
// L'API ne fait que relayer : elle impose la langue, l'unité et la distance maximale
// d'accroche (search_cutoff), puis renvoie une forme compacte à l'app.
package route

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"time"
	_ "time/tzdata" // l'image de l'API n'a pas de base de fuseaux horaires
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
	// Toutes les requêtes vont au même hôte : sans ce réglage, Go ne garde que 2 connexions au repos
	// et en rouvre une à chaque pic de calculs simultanés.
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.MaxIdleConnsPerHost = 32
	return &Client{base: baseURL, http: &http.Client{Timeout: 5 * time.Second, Transport: t}}
}

// Options d'un calcul d'itinéraire ; la valeur zéro donne le plus rapide, en partant maintenant.
type Options struct {
	// Alternates : nombre d'itinéraires en plus du meilleur, borné à MaxAlternates.
	Alternates int
	// Heading : cap au départ, en degrés depuis le nord. Évite de faire partir à contresens
	// (et donc de faire faire demi-tour) une voiture qui roule déjà. nil si inconnu.
	Heading *float64
	// Depart : heure de départ, pour l'heure d'arrivée et les restrictions horaires
	// (zones piétonnes, accès réglementés). Zéro : maintenant.
	Depart time.Time
	// Évitements souples : Valhalla les contourne s'il existe un autre chemin.
	AvoidTolls, AvoidHighways bool
}

// HeadingTolerance (°) : écart admis entre le cap donné et la direction de la route.
const HeadingTolerance = 45

// Reims, comme toute la zone couverte : Valhalla attend l'heure locale du point de départ.
var paris = mustLoad("Europe/Paris")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

type location struct {
	Lat              float64  `json:"lat"`
	Lon              float64  `json:"lon"`
	SearchCutoff     int      `json:"search_cutoff"`
	Heading          *float64 `json:"heading,omitempty"`
	HeadingTolerance int      `json:"heading_tolerance,omitempty"`
}

type dateTime struct {
	Type  int    `json:"type"` // 1 : partir à
	Value string `json:"value"`
}

type autoCosting struct {
	UseTolls    *float64 `json:"use_tolls,omitempty"`
	UseHighways *float64 `json:"use_highways,omitempty"`
}

type request struct {
	Locations      []location           `json:"locations"`
	Costing        Mode                 `json:"costing"`
	CostingOptions map[Mode]autoCosting `json:"costing_options,omitempty"`
	DateTime       *dateTime            `json:"date_time,omitempty"`
	Alternates     int                  `json:"alternates,omitempty"`
	Directions     struct {
		Language string `json:"language"`
		Units    string `json:"units"`
	} `json:"directions_options"`
}

type trip struct {
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
}

type response struct {
	trip
	Alternates []trip `json:"alternates"`
	ErrorCode  int    `json:"error_code"`
	Error      string `json:"error"`
}

// MaxAlternates : Valhalla propose au plus deux itinéraires en plus du meilleur.
const MaxAlternates = 2

// Routes calcule l'itinéraire de from à to, puis jusqu'à opts.Alternates autres, du plus rapide au plus lent.
func (c *Client) Routes(ctx context.Context, from, to Point, mode Mode, opts Options) ([]Route, error) {
	var req request
	start := location{Lat: from.Lat, Lon: from.Lon, SearchCutoff: SearchCutoff}
	if opts.Heading != nil {
		start.Heading, start.HeadingTolerance = opts.Heading, HeadingTolerance
	}
	req.Locations = []location{start, {Lat: to.Lat, Lon: to.Lon, SearchCutoff: SearchCutoff}}
	req.Costing = mode
	req.Alternates = min(max(opts.Alternates, 0), MaxAlternates)
	if !opts.Depart.IsZero() {
		req.DateTime = &dateTime{Type: 1, Value: opts.Depart.In(paris).Format("2006-01-02T15:04")}
	}
	if mode == Car && (opts.AvoidTolls || opts.AvoidHighways) {
		var a autoCosting
		zero := 0.0
		if opts.AvoidTolls {
			a.UseTolls = &zero
		}
		if opts.AvoidHighways {
			a.UseHighways = &zero
		}
		req.CostingOptions = map[Mode]autoCosting{Car: a}
	}
	req.Directions.Language = "fr-FR"
	req.Directions.Units = "kilometers"
	body, _ := json.Marshal(req)

	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/route", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(hreq)
	if err != nil {
		return nil, fmt.Errorf("valhalla: %w", err)
	}
	defer res.Body.Close()

	var out response
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("valhalla: réponse illisible (HTTP %d): %w", res.StatusCode, err)
	}
	if res.StatusCode != http.StatusOK {
		switch out.ErrorCode {
		case 170, 171: // aucune route à moins de search_cutoff
			return nil, ErrOutOfArea
		case 442: // points accrochés mais non reliés
			return nil, ErrNoRoute
		}
		return nil, fmt.Errorf("valhalla: HTTP %d, erreur %d: %s", res.StatusCode, out.ErrorCode, out.Error)
	}

	routes := make([]Route, 0, 1+len(out.Alternates))
	for _, t := range append([]trip{out.trip}, out.Alternates...) {
		r, err := t.route()
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	slices.SortStableFunc(routes, func(a, b Route) int { return cmp.Compare(a.Duration, b.Duration) })
	return routes, nil
}

func (t trip) route() (Route, error) {
	r := Route{Distance: t.Trip.Summary.Length * 1000, Duration: t.Trip.Summary.Time}
	for _, leg := range t.Trip.Legs {
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
