package route

import (
	"math"
	"unicode"
	"unicode/utf8"
)

// Control : feu tricolore ou stop d'OpenStreetMap (highway=traffic_signals, highway=stop).
type Control struct {
	Kind     string // « feu », « stop »
	Lat, Lon float64
}

const (
	// Un feu ou un stop est cartographié sur la voie d'arrivée, quelques mètres avant le carrefour,
	// ou sur le carrefour lui-même.
	controlBefore = 35.0
	controlAfter  = 5.0
	// Écart maximal au tracé : au-delà, il concerne une autre rue du carrefour.
	controlOffset = 10.0
	// ControlRadius : rayon de recherche autour d'un point de manœuvre (m), qui couvre la fenêtre.
	ControlRadius = controlBefore + controlOffset
)

// Annotate marque les manœuvres qui se font à un feu ou à un stop (« Au feu, tournez à droite »).
// Un feu placé juste après le carrefour règle le sens inverse : la fenêtre (35 m avant, 5 m
// après le point de manœuvre) l'écarte. Les ronds-points et l'arrivée ne sont pas concernés.
func Annotate(r *Route, controls []Control) {
	if len(controls) == 0 || len(r.Coordinates) < 2 {
		return
	}
	cum := make([]float64, len(r.Coordinates))
	for i := 1; i < len(cum); i++ {
		cum[i] = cum[i-1] + meters(r.Coordinates[i-1], r.Coordinates[i])
	}
	for k := range r.Steps {
		s := &r.Steps[k]
		if k == 0 || s.Type == 26 || s.Type == 27 || (s.Type >= 4 && s.Type <= 6) || s.Shape >= len(cum) {
			continue
		}
		at := cum[s.Shape]
		best := ""
		for _, c := range controls {
			p := [2]float64{c.Lon, c.Lat}
			if meters(p, r.Coordinates[s.Shape]) > ControlRadius {
				continue
			}
			along, off := project(r.Coordinates, cum, p, at-controlBefore, at+controlAfter)
			if off <= controlOffset && along >= at-controlBefore && along <= at+controlAfter {
				if best == "" || c.Kind == "feu" { // un feu l'emporte sur un stop
					best = c.Kind
				}
			}
		}
		if best != "" {
			s.Control = best
			s.Instruction = prefix(best) + lowerFirst(s.Instruction)
		}
	}
}

// project : point du tracé le plus proche de p parmi les segments entre les abscisses from et to,
// renvoyé comme (abscisse, écart) en mètres.
func project(pts [][2]float64, cum []float64, p [2]float64, from, to float64) (along, off float64) {
	off = math.Inf(1)
	c := math.Cos(p[1] * math.Pi / 180)
	const m = 111_320.0
	for i := 0; i+1 < len(pts); i++ {
		if cum[i+1] < from || cum[i] > to {
			continue
		}
		ax, ay := (pts[i][0]-p[0])*m*c, (pts[i][1]-p[1])*m
		bx, by := (pts[i+1][0]-p[0])*m*c, (pts[i+1][1]-p[1])*m
		dx, dy := bx-ax, by-ay
		t := 0.0
		if l2 := dx*dx + dy*dy; l2 > 0 {
			t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/l2))
		}
		if d := math.Hypot(ax+t*dx, ay+t*dy); d < off {
			off, along = d, cum[i]+t*(cum[i+1]-cum[i])
		}
	}
	return along, off
}

func prefix(kind string) string {
	if kind == "stop" {
		return "Au stop, "
	}
	return "Au feu, "
}

// lowerFirst : « Tournez à droite… » devient « tournez à droite… » derrière « Au feu, ».
func lowerFirst(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	return string(unicode.ToLower(r)) + s[n:]
}
