package route

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Control : feu tricolore, stop ou cédez-le-passage d'OpenStreetMap.
type Control struct {
	Kind string  `json:"kind"` // « feu », « stop », « cédez »
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

const (
	// Un feu ou un stop est cartographié sur la voie d'arrivée, quelques mètres avant le carrefour,
	// ou sur le carrefour lui-même.
	controlBefore = 35.0
	controlAfter  = 5.0
	// ControlOffset : écart maximal au tracé (m) ; au-delà, il concerne une autre rue du carrefour.
	ControlOffset = 10.0
	// Affiché sur la carte : le nœud OSM est sur la route suivie, dont Valhalla reprend tous les
	// points. Un stop de la rue transversale, à quelques mètres du carrefour, en est écarté.
	onRouteOffset = 2.0
)

// Annotate marque les manœuvres qui se font à un feu, un stop ou un cédez-le-passage (« Au feu,
// tournez à droite »).
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
			if meters(p, r.Coordinates[s.Shape]) > controlBefore+ControlOffset {
				continue
			}
			along, off := project(r.Coordinates, cum, p, at-controlBefore, at+controlAfter)
			if off <= ControlOffset && along >= at-controlBefore && along <= at+controlAfter {
				if rank[c.Kind] > rank[best] { // un feu l'emporte sur un stop, un stop sur un cédez-le-passage
					best = c.Kind
				}
			}
		}
		if best != "" {
			s.Control = best
			s.Instruction = prefix(best) + lowerFirst(s.Instruction)
			for i := range s.Voice {
				s.Voice[i].Text = voiceControl(s.Voice[i].Text, best)
			}
		}
	}
}

// Place range sur la carte les feux, stops et cédez-le-passage du trajet, dans l'ordre de passage,
// posés sur le tracé. À appeler après Annotate.
//
// Un feu à moins de ControlOffset du tracé règle le carrefour qu'on traverse : il est gardé (les
// feux de chaque branche, à quelques mètres les uns des autres, n'en font qu'un). Un stop ou un
// cédez-le-passage à côté du tracé peut être celui de la rue transversale, où l'on a la priorité :
// il n'est gardé que s'il est sur la route suivie, ou s'il règle une manœuvre annotée.
func Place(r *Route, controls []Control) {
	r.Controls = nil
	if len(r.Coordinates) < 2 {
		return
	}
	cum := make([]float64, len(r.Coordinates))
	for i := 1; i < len(cum); i++ {
		cum[i] = cum[i-1] + meters(r.Coordinates[i-1], r.Coordinates[i])
	}
	end := cum[len(cum)-1]
	annotated := func(kind string, along float64) bool {
		for _, st := range r.Steps {
			if st.Control == kind && st.Shape < len(cum) && along >= cum[st.Shape]-controlBefore && along <= cum[st.Shape]+controlAfter {
				return true
			}
		}
		return false
	}
	type placed struct {
		kind  string
		along float64
	}
	var on []placed
	for _, c := range controls {
		along, off := project(r.Coordinates, cum, [2]float64{c.Lon, c.Lat}, 0, end)
		if off <= onRouteOffset || (off <= ControlOffset && (c.Kind == "feu" || annotated(c.Kind, along))) {
			on = append(on, placed{c.Kind, along})
		}
	}
	slices.SortFunc(on, func(a, b placed) int { return cmp.Compare(a.along, b.along) })
	for i := 0; i < len(on); {
		// Un carrefour : les repères qui se suivent à moins de controlMerge, le plus fort l'emporte.
		best, k := on[i], i+1
		for ; k < len(on) && on[k].along-on[k-1].along <= controlMerge; k++ {
			if rank[on[k].kind] > rank[best.kind] {
				best.kind = on[k].kind
			}
		}
		p := pointAt(r.Coordinates, cum, best.along)
		r.Controls = append(r.Controls, Control{Kind: best.kind, Lat: p[1], Lon: p[0]})
		i = k
	}
}

// controlMerge : repères d'un même carrefour (m le long du tracé).
const controlMerge = 30.0

// pointAt : le point du tracé à l'abscisse along (m).
func pointAt(pts [][2]float64, cum []float64, along float64) [2]float64 {
	i, _ := slices.BinarySearch(cum, along)
	if i == 0 {
		return pts[0]
	}
	if i >= len(pts) {
		return pts[len(pts)-1]
	}
	t := 0.0
	if d := cum[i] - cum[i-1]; d > 0 {
		t = (along - cum[i-1]) / d
	}
	return [2]float64{pts[i-1][0] + t*(pts[i][0]-pts[i-1][0]), pts[i-1][1] + t*(pts[i][1]-pts[i-1][1])}
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

// voiceControl place le repère dans l'annonce de la manœuvre : « Dans 100 mètres, au feu,
// tournez à droite… », « …Ensuite, au stop, tournez… ». L'annonce qui ne parle que de la route
// en cours (« Continuez pendant 600 mètres. ») reste telle quelle.
func voiceControl(text, kind string) string {
	if i := strings.Index(text, "Ensuite, "); i >= 0 {
		i += len("Ensuite, ")
		return text[:i] + lowerFirst(prefix(kind)) + text[i:]
	}
	if strings.HasPrefix(text, "Continuez") || strings.HasPrefix(text, "Conduisez") {
		return text
	}
	if strings.HasPrefix(text, "Dans ") {
		if i := strings.Index(text, ", "); i >= 0 {
			return text[:i+2] + lowerFirst(prefix(kind)) + text[i+2:]
		}
	}
	return prefix(kind) + lowerFirst(text)
}

var rank = map[string]int{"cédez": 1, "stop": 2, "feu": 3}

func prefix(kind string) string {
	switch kind {
	case "stop":
		return "Au stop, "
	case "cédez":
		return "Au cédez-le-passage, "
	}
	return "Au feu, "
}

// lowerFirst : « Tournez à droite… » devient « tournez à droite… » derrière « Au feu, ».
func lowerFirst(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	return string(unicode.ToLower(r)) + s[n:]
}
