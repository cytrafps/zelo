package route

import (
	"cmp"
	"math"
	"slices"
)

// Area : une aire d'autoroute sur le trajet, avec ce qui aide à choisir où s'arrêter.
type Area struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"` // « services » ou « rest_area »
	Name     string   `json:"name"`
	Lat      float64  `json:"lat"`
	Lon      float64  `json:"lon"`
	Services []string `json:"services"`
	// Fuel : prix le plus bas de chaque carburant aux stations de l'aire (€/L) ; vide sans station.
	Fuel map[string]float64 `json:"fuel,omitempty"`
	// Charge : points de recharge de l'aire ; nil s'il n'y en a pas (ou hors de la zone importée).
	Charge *AreaCharge `json:"charge,omitempty"`
	// Along : distance depuis le départ, en mètres.
	Along float64 `json:"along"`
}

type AreaCharge struct {
	Total int `json:"total"`
	// Available : points libres ; nil sans état récent publié.
	Available *int `json:"available"`
}

// AreaReach : au-delà de cette distance au tracé, le centre d'une aire n'est pas desservi par lui.
const AreaReach = 400.0

// PlaceAreas garde les aires que le trajet dessert vraiment et les range dans l'ordre de passage.
// Desservie : à moins de AreaReach d'un tronçon d'autoroute du trajet, et du côté droit de la
// chaussée (on roule à droite : l'aire d'en face est sur l'autre sens, sans accès).
func PlaceAreas(r *Route, candidates []Area) {
	if len(r.Coordinates) < 2 {
		return
	}
	cum := make([]float64, len(r.Coordinates))
	for i := 1; i < len(cum); i++ {
		cum[i] = cum[i-1] + meters(r.Coordinates[i-1], r.Coordinates[i])
	}
	var out []Area
	for _, a := range candidates {
		seg, along, off, side := nearestMotorway(r, cum, [2]float64{a.Lon, a.Lat})
		if seg < 0 || off > AreaReach || side >= 0 {
			continue
		}
		a.Along = along
		out = append(out, a)
	}
	slices.SortFunc(out, func(x, y Area) int { return cmp.Compare(x.Along, y.Along) })
	r.Areas = out
}

// nearestMotorway : segment d'autoroute du tracé le plus proche de p, l'abscisse du point le plus
// proche, l'écart (m) et le côté (< 0 : à droite dans le sens du trajet). seg = -1 : aucune autoroute.
func nearestMotorway(r *Route, cum []float64, p [2]float64) (seg int, along, off, side float64) {
	seg, off = -1, math.Inf(1)
	c := math.Cos(p[1] * math.Pi / 180)
	const m = 111_320.0
	pts := r.Coordinates
	for i := 0; i+1 < len(pts); i++ {
		if i >= len(r.motorway) || !r.motorway[i] {
			continue
		}
		ax, ay := (pts[i][0]-p[0])*m*c, (pts[i][1]-p[1])*m
		bx, by := (pts[i+1][0]-p[0])*m*c, (pts[i+1][1]-p[1])*m
		dx, dy := bx-ax, by-ay
		t := 0.0
		if l2 := dx*dx + dy*dy; l2 > 0 {
			t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/l2))
		}
		qx, qy := ax+t*dx, ay+t*dy // point du tracé, relatif à p
		if d := math.Hypot(qx, qy); d < off {
			// p - q = (-qx, -qy) ; produit vectoriel direction × (p - q) : négatif à droite.
			seg, off, along, side = i, d, cum[i]+t*(cum[i+1]-cum[i]), dx*(-qy)-dy*(-qx)
		}
	}
	return seg, along, off, side
}
