// Package route calcule les itinéraires avec Valhalla, auto-hébergé à côté de l'API.
//
// L'API impose la langue, l'unité et la distance maximale d'accroche (search_cutoff), demande
// la réponse au format OSRM (le seul qui donne les voies de circulation), puis renvoie une forme
// compacte à l'app.
package route

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // l'image de l'API n'a pas de base de fuseaux horaires

	"github.com/cytrafps/zelo/services/api/internal/toll"
)

// Mode de déplacement : en voiture, à moto ou à vélo jusqu'à l'arrêt, à pied jusqu'à la destination.
type Mode string

const (
	Car        Mode = "auto"
	Motorcycle Mode = "motorcycle"
	Bicycle    Mode = "bicycle"
	Walk       Mode = "pedestrian"
)

// Motorized : modes sur la chaussée des voitures, autoroutes et péages compris.
func (m Mode) Motorized() bool { return m == Car || m == Motorcycle }

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
	// Lanes : voies à l'approche de la manœuvre, de gauche à droite ; absent si la route n'en
	// décrit pas ou si toutes conviennent (rien à montrer).
	Lanes []Lane `json:"lanes,omitempty"`
	// Control : feu, stop ou cédez-le-passage au carrefour de la manœuvre, voir Annotate.
	Control string `json:"control,omitempty"`
	// Voice : annonces vocales de la manœuvre, la plus lointaine d'abord.
	Voice []Voice `json:"voice,omitempty"`
}

// Voice : une annonce à dire quand il reste Before mètres jusqu'à la manœuvre (« Dans 200
// mètres, tournez à droite… »). Valhalla les rédige et les place lui-même.
type Voice struct {
	Before float64 `json:"before"`
	Text   string  `json:"text"`
}

// Lane : une voie, ses flèches au sol (« left », « straight », « slight right »…) et si elle
// mène à la manœuvre.
type Lane struct {
	Directions []string `json:"directions"`
	Take       bool     `json:"take"`
}

type Route struct {
	Distance    float64      `json:"distance"` // mètres
	Duration    float64      `json:"duration"` // secondes
	Coordinates [][2]float64 `json:"coordinates"`
	Steps       []Step       `json:"steps"`
	// Areas : aires d'autoroute desservies par le trajet, dans l'ordre de passage (voir PlaceAreas).
	Areas []Area `json:"areas,omitempty"`
	// Controls : feux, stops et cédez-le-passage de la route suivie, dans l'ordre (voir Place).
	Controls []Control `json:"controls,omitempty"`
	// Toll : péage du trajet, pour le véhicule demandé ; absent sans péage (voir toll.Compute).
	Toll *toll.Fare `json:"toll,omitempty"`

	// motorway[i] : le segment i → i+1 du tracé est sur autoroute.
	motorway []bool
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
	// Exclude : zones interdites (rues fermées), anneaux [lon, lat] ; voir Around et Corridor.
	Exclude [][][2]float64
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
	Format         string               `json:"format"`
	Voice          bool                 `json:"voice_instructions"`
	Exclude        [][][2]float64       `json:"exclude_polygons,omitempty"`
	Directions     struct {
		Language string `json:"language"`
		Units    string `json:"units"`
	} `json:"directions_options"`
}

// Réponse au format OSRM (format: "osrm") : seule à décrire les voies aux carrefours.
type osrmLane struct {
	Indications []string `json:"indications"`
	Valid       bool     `json:"valid"`
	Active      bool     `json:"active"`
}

type osrmStep struct {
	Name     string  `json:"name"`
	Distance float64 `json:"distance"` // m
	Duration float64 `json:"duration"` // s
	Maneuver struct {
		Type        string `json:"type"`
		Modifier    string `json:"modifier"`
		Instruction string `json:"instruction"`
	} `json:"maneuver"`
	Intersections []osrmIntersection `json:"intersections"`
	// Annonces menant à la manœuvre suivante, placées en mètres avant la fin de l'étape.
	VoiceInstructions []struct {
		Announcement          string  `json:"announcement"`
		DistanceAlongGeometry float64 `json:"distanceAlongGeometry"`
	} `json:"voiceInstructions"`
}

type osrmIntersection struct {
	GeometryIndex int        `json:"geometry_index"`
	Lanes         []osrmLane `json:"lanes"`
	Classes       []string   `json:"classes"` // « motorway », « toll »…
}

type osrmRoute struct {
	Distance float64 `json:"distance"`
	Duration float64 `json:"duration"`
	Geometry string  `json:"geometry"`
	Legs     []struct {
		Steps []osrmStep `json:"steps"`
	} `json:"legs"`
}

type response struct {
	Code    string      `json:"code"` // « Ok », « NoSegment », « NoRoute »…
	Message string      `json:"message"`
	Routes  []osrmRoute `json:"routes"`
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
	if mode.Motorized() && (opts.AvoidTolls || opts.AvoidHighways) {
		var a autoCosting
		zero := 0.0
		if opts.AvoidTolls {
			a.UseTolls = &zero
		}
		if opts.AvoidHighways {
			a.UseHighways = &zero
		}
		req.CostingOptions = map[Mode]autoCosting{mode: a}
	}
	req.Format = "osrm"
	req.Voice = true
	req.Exclude = opts.Exclude
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
	if res.StatusCode != http.StatusOK || out.Code != "Ok" {
		switch out.Code {
		case "NoSegment": // aucune route à moins de search_cutoff
			return nil, ErrOutOfArea
		case "NoRoute": // points accrochés mais non reliés
			return nil, ErrNoRoute
		}
		return nil, fmt.Errorf("valhalla: HTTP %d, %s: %s", res.StatusCode, out.Code, out.Message)
	}

	routes := make([]Route, 0, len(out.Routes))
	for _, o := range out.Routes {
		r, err := o.route()
		if err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	slices.SortStableFunc(routes, func(a, b Route) int { return cmp.Compare(a.Duration, b.Duration) })
	return routes, nil
}

func (o osrmRoute) route() (Route, error) {
	pts, err := decodePolyline6(o.Geometry)
	if err != nil {
		return Route{}, fmt.Errorf("valhalla: tracé: %w", err)
	}
	r := Route{Distance: o.Distance, Duration: o.Duration, Coordinates: pts, motorway: make([]bool, len(pts))}
	for _, leg := range o.Legs {
		// La classe d'un carrefour vaut jusqu'au suivant.
		var marks []struct {
			at   int
			fast bool
		}
		for _, st := range leg.Steps {
			for _, x := range st.Intersections {
				marks = append(marks, struct {
					at   int
					fast bool
				}{x.GeometryIndex, slices.Contains(x.Classes, "motorway")})
			}
		}
		for i, m := range marks {
			end := len(pts)
			if i+1 < len(marks) {
				end = marks[i+1].at
			}
			for k := max(m.at, 0); k < end && k < len(pts); k++ {
				r.motorway[k] = m.fast
			}
		}
		base := len(r.Steps)
		for k, st := range leg.Steps {
			if len(st.Intersections) == 0 {
				return Route{}, errors.New("valhalla: étape sans point de manœuvre")
			}
			s := Step{
				Instruction: st.Maneuver.Instruction,
				Street:      st.Name,
				Type:        maneuverType(st.Maneuver.Type, st.Maneuver.Modifier),
				Distance:    st.Distance,
				Duration:    st.Duration,
				Shape:       st.Intersections[0].GeometryIndex,
			}
			if st.Maneuver.Type == "arrive" {
				s.Street = "" // la consigne (« destination sur la droite ») dit mieux l'arrivée que la rue
			} else if k > 0 {
				s.Lanes = approachLanes(leg.Steps[k-1], st, pts)
			}
			r.Steps = append(r.Steps, s)
		}
		// Les annonces d'une étape préparent la manœuvre suivante : elles lui sont rattachées.
		for k := 1; k < len(leg.Steps); k++ {
			next := &r.Steps[base+k]
			for _, v := range leg.Steps[k-1].VoiceInstructions {
				next.Voice = append(next.Voice, Voice{Before: v.DistanceAlongGeometry, Text: tidyVoice(v.Announcement)})
			}
		}
	}
	return r, nil
}

// prefaces : débuts d'annonce que Valhalla fait suivre d'une majuscule (« Ensuite, Tournez… »).
var prefaces = regexp.MustCompile(`(Ensuite, |(?:^|Ensuite, )[Dd]ans [^,]+, )(\p{Lu})(\p{Ll})`)

// tidyVoice corrige la rédaction de Valhalla : majuscule après « Ensuite, » ou « Dans 200
// mètres, », point doublé en fin d'annonce.
func tidyVoice(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "..", ".")
	// « Ensuite, Dans 80 mètres, Tournez » : chaque passe corrige un niveau.
	for range 3 {
		t := prefaces.ReplaceAllStringFunc(s, func(m string) string {
			p := prefaces.FindStringSubmatch(m)
			return p[1] + strings.ToLower(p[2]) + p[3]
		})
		if t == s {
			break
		}
		s = t
	}
	return s
}

// LanesWithin : au-delà, des voies décrites avant la manœuvre concernent un autre carrefour.
const LanesWithin = 150.0

// approachLanes : les voies à prendre pour la manœuvre de st. Valhalla les décrit au carrefour
// de la manœuvre, ou (plus souvent) au dernier carrefour qui la précède, avec les voies qui y
// mènent marquées « active ». Rien si toutes les voies conviennent : il n'y a pas à choisir.
func approachLanes(prev, st osrmStep, pts [][2]float64) []Lane {
	at := st.Intersections[0]
	lanes := at.Lanes
	if len(lanes) == 0 {
		for i := len(prev.Intersections) - 1; i >= 1; i-- {
			x := prev.Intersections[i]
			if len(x.Lanes) == 0 {
				continue
			}
			if pathLength(pts, x.GeometryIndex, at.GeometryIndex) <= LanesWithin {
				lanes = x.Lanes
			}
			break
		}
	}
	if len(lanes) < 2 {
		return nil
	}
	out := make([]Lane, len(lanes))
	all, fits := true, false
	want := laneDirection(st.Maneuver.Modifier)
	for i, l := range lanes {
		take := l.Active || (l.Valid && !anyActive(lanes))
		out[i] = Lane{Directions: l.Indications, Take: take}
		all = all && take
		if take {
			for _, d := range l.Indications {
				fits = fits || strings.Contains(d, want) || (want == "left" && d == "uturn")
			}
		}
	}
	// Toutes conviennent : rien à choisir. Aucune voie retenue ne va dans le sens de la manœuvre :
	// ces voies décrivent un carrefour intermédiaire (on y va tout droit), pas celui où l'on tourne.
	if all || !fits {
		return nil
	}
	return out
}

// laneDirection : la flèche au sol attendue pour une manœuvre (« left », « right », « straight »).
func laneDirection(modifier string) string {
	switch {
	case modifier == "uturn" || strings.Contains(modifier, "left"):
		return "left"
	case strings.Contains(modifier, "right"):
		return "right"
	}
	return "straight"
}

func anyActive(lanes []osrmLane) bool {
	for _, l := range lanes {
		if l.Active {
			return true
		}
	}
	return false
}

// pathLength : longueur (m) du tracé entre les points i et j.
func pathLength(pts [][2]float64, i, j int) float64 {
	d := 0.0
	for k := max(i, 0); k < j && k+1 < len(pts); k++ {
		d += meters(pts[k], pts[k+1])
	}
	return d
}

// meters : distance entre deux points [lon, lat] proches (projection locale, exacte sur une ville).
func meters(a, b [2]float64) float64 {
	const mPerDeg = 111_320.0
	c := math.Cos((a[1] + b[1]) / 2 * math.Pi / 180)
	return math.Hypot((b[0]-a[0])*mPerDeg*c, (b[1]-a[1])*mPerDeg)
}

// maneuverType traduit la manœuvre OSRM en type Valhalla (valhalla/odin/maneuver.h), que l'app
// connaît déjà pour choisir ses icônes. Demi-tour par la gauche : on roule à droite (le champ
// driving_side de Valhalla 3.9 vaut « left » même en France, il n'est pas fiable).
func maneuverType(kind, modifier string) int {
	side := func(straight, right, left int) int {
		switch {
		case strings.Contains(modifier, "right"):
			return right
		case strings.Contains(modifier, "left"):
			return left
		}
		return straight
	}
	switch kind {
	case "depart":
		return side(1, 2, 3)
	case "arrive":
		return side(4, 5, 6)
	case "roundabout", "rotary", "roundabout turn":
		return 26
	case "exit roundabout", "exit rotary":
		return 27
	case "on ramp":
		return side(17, 18, 19)
	case "off ramp":
		return side(20, 20, 21)
	case "fork":
		return side(22, 23, 24)
	case "merge":
		return side(25, 37, 38)
	}
	switch modifier {
	case "uturn":
		return 13
	case "sharp right":
		return 11
	case "right":
		return 10
	case "slight right":
		return 9
	case "slight left":
		return 16
	case "left":
		return 15
	case "sharp left":
		return 14
	}
	return 8 // tout droit, nouveau nom de rue
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
