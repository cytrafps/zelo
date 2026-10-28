package route

import "math"

// ClosureWidth (m) : demi-largeur de la zone tracée autour d'une rue fermée. Assez pour couvrir
// les deux sens de la chaussée, pas assez pour toucher la rue parallèle.
const ClosureWidth = 6.0

// Along : anneau qui entoure le tracé `line` ([lon, lat]) à `width` mètres de part et d'autre,
// pour exclure une rue fermée du calcul (exclude_polygons de Valhalla). Les deux bouts sont
// raccourcis de 2 × width : une rue fermée « jusqu'au boulevard » ne ferme pas le boulevard.
func Along(line [][2]float64, width float64) [][2]float64 {
	line = trim(line, 2*width)
	if len(line) < 2 {
		return nil
	}
	cos := math.Cos(line[0][1] * math.Pi / 180)
	const m = 111_320.0
	left := make([][2]float64, len(line))
	right := make([][2]float64, len(line))
	for i := range line {
		a, b := line[max(i-1, 0)], line[min(i+1, len(line)-1)]
		dx, dy := (b[0]-a[0])*m*cos, (b[1]-a[1])*m
		n := math.Hypot(dx, dy)
		if n == 0 {
			n = 1
		}
		// Normale au tracé, en degrés.
		ox, oy := -dy/n*width/(m*cos), dx/n*width/m
		left[i] = [2]float64{line[i][0] + ox, line[i][1] + oy}
		right[i] = [2]float64{line[i][0] - ox, line[i][1] - oy}
	}
	ring := append(left, reversed(right)...)
	return append(ring, ring[0])
}

// Around : carré de `half` mètres de demi-côté autour de p, pour un point signalé fermé.
func Around(p Point, half float64) [][2]float64 {
	dlat := half / 111_320
	dlon := dlat / math.Cos(p.Lat*math.Pi/180)
	return [][2]float64{
		{p.Lon - dlon, p.Lat - dlat}, {p.Lon + dlon, p.Lat - dlat}, {p.Lon + dlon, p.Lat + dlat},
		{p.Lon - dlon, p.Lat + dlat}, {p.Lon - dlon, p.Lat - dlat},
	}
}

func reversed(s [][2]float64) [][2]float64 {
	out := make([][2]float64, len(s))
	for i, p := range s {
		out[len(s)-1-i] = p
	}
	return out
}

// trim retire `cut` mètres à chaque bout du tracé ; rien s'il est trop court.
func trim(line [][2]float64, cut float64) [][2]float64 {
	if len(line) < 2 {
		return nil
	}
	cos := math.Cos(line[0][1] * math.Pi / 180)
	seg := func(a, b [2]float64) float64 {
		return math.Hypot((b[0]-a[0])*111_320*cos, (b[1]-a[1])*111_320)
	}
	var total float64
	for i := 1; i < len(line); i++ {
		total += seg(line[i-1], line[i])
	}
	if total <= 2*cut {
		return nil
	}
	at := func(d float64) ([2]float64, int) { // point à d mètres du début, et indice du point suivant
		for i := 1; i < len(line); i++ {
			l := seg(line[i-1], line[i])
			if d <= l && l > 0 {
				f := d / l
				return [2]float64{line[i-1][0] + f*(line[i][0]-line[i-1][0]), line[i-1][1] + f*(line[i][1]-line[i-1][1])}, i
			}
			d -= l
		}
		return line[len(line)-1], len(line)
	}
	start, i := at(cut)
	end, j := at(total - cut)
	out := append([][2]float64{start}, line[i:j]...)
	return append(out, end)
}

// Perimeter : longueur (m) d'un anneau [lon, lat].
func Perimeter(ring [][2]float64) float64 {
	if len(ring) < 2 {
		return 0
	}
	cos := math.Cos(ring[0][1] * math.Pi / 180)
	var m float64
	for i := 1; i < len(ring); i++ {
		m += math.Hypot((ring[i][0]-ring[i-1][0])*111_320*cos, (ring[i][1]-ring[i-1][1])*111_320)
	}
	return m
}
