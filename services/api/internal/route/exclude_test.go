package route

import (
	"math"
	"testing"
)

func TestAlong(t *testing.T) {
	// 200 m vers l'est : la zone commence et finit 12 m en retrait, à 6 m de part et d'autre.
	line := [][2]float64{{4.0, 49.25}, {4.0 + 200/(111_320*math.Cos(49.25*math.Pi/180)), 49.25}}
	ring := Along(line, ClosureWidth)
	if len(ring) != 5 || ring[0] != ring[4] {
		t.Fatalf("%v", ring)
	}
	cos := math.Cos(49.25 * math.Pi / 180)
	x := func(p [2]float64) float64 { return (p[0] - 4.0) * 111_320 * cos }
	y := func(p [2]float64) float64 { return (p[1] - 49.25) * 111_320 }
	if math.Abs(x(ring[0])-12) > 0.01 || math.Abs(x(ring[1])-188) > 0.01 || math.Abs(y(ring[0])-6) > 0.01 || math.Abs(y(ring[2])+6) > 0.01 {
		t.Errorf("%.2f %.2f %.2f %.2f", x(ring[0]), x(ring[1]), y(ring[0]), y(ring[2]))
	}
	if Along(line[:1], 6) != nil || Along([][2]float64{{4, 49.25}, {4.0001, 49.25}}, 6) != nil {
		t.Error("tracé trop court : rien à exclure")
	}
	if p := Perimeter(ring); math.Abs(p-2*(176+12)) > 0.1 {
		t.Errorf("périmètre %.2f", p)
	}
	sq := Around(Point{Lat: 49.25, Lon: 4}, 12)
	if len(sq) != 5 || math.Abs(y(sq[2])-12) > 0.01 {
		t.Errorf("%v", sq)
	}
}
