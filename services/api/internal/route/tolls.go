package route

import (
	"cmp"
	"slices"

	"github.com/cytrafps/zelo/services/api/internal/toll"
)

// TollReach (m) : un poste de péage à cette distance du tracé est franchi. Le tracé suit les
// nœuds OSM : le poste franchi est dessous ; celui de la chaussée d'en face désigne la même gare.
const TollReach = 15.0

// leaveGap (m) : hors autoroute sur plus que ça entre deux postes, le trajet est sorti du péage
// (le ticket suivant est un autre ticket).
const leaveGap = 500.0

// TollPoint : un poste de péage et le nom de sa gare dans la grille (vide : non rattaché).
type TollPoint struct {
	Gare     string
	Lat, Lon float64
}

// HasToll : le trajet emprunte une route à péage (classe « toll » de Valhalla).
func (r *Route) HasToll() bool { return slices.Contains(r.tolled, true) }

// TollPassages : les postes franchis, dans l'ordre du trajet, et si le trajet a quitté
// l'autoroute depuis le précédent.
func TollPassages(r *Route, points []TollPoint) []toll.Passage {
	if len(r.Coordinates) < 2 {
		return nil
	}
	cum := make([]float64, len(r.Coordinates))
	for i := 1; i < len(cum); i++ {
		cum[i] = cum[i-1] + meters(r.Coordinates[i-1], r.Coordinates[i])
	}
	type hit struct {
		gare  string
		along float64
	}
	var hits []hit
	for _, p := range points {
		along, off := project(r.Coordinates, cum, [2]float64{p.Lon, p.Lat}, 0, cum[len(cum)-1])
		if off <= TollReach {
			hits = append(hits, hit{p.Gare, along})
		}
	}
	slices.SortStableFunc(hits, func(a, b hit) int { return cmp.Compare(a.along, b.along) })
	out := make([]toll.Passage, len(hits))
	for i, h := range hits {
		out[i].Gare = h.gare
		if i > 0 {
			out[i].Break = r.offMotorway(cum, hits[i-1].along, h.along) > leaveGap
		}
	}
	return out
}

// offMotorway : mètres hors autoroute entre deux abscisses du tracé.
func (r *Route) offMotorway(cum []float64, from, to float64) float64 {
	var d float64
	for i := 0; i+1 < len(cum) && i < len(r.motorway); i++ {
		if cum[i+1] <= from || cum[i] >= to || r.motorway[i] {
			continue
		}
		d += min(cum[i+1], to) - max(cum[i], from)
	}
	return d
}

// WithToll : le trajet, entièrement sur autoroute à péage (pour les tests des appelants).
func WithToll(r Route) Route {
	r.motorway, r.tolled = make([]bool, len(r.Coordinates)), make([]bool, len(r.Coordinates))
	for i := range r.tolled {
		r.motorway[i], r.tolled[i] = true, true
	}
	return r
}
