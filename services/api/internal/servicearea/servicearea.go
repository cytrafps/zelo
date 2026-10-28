// Package servicearea lit les aires d'autoroute et de repos d'OpenStreetMap (via Overpass) et
// ce qu'on y trouve : restauration, toilettes, douches, services camping-car, boutique…
package servicearea

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// Services, dans l'ordre où l'app les montre.
const (
	Restauration = "restauration"
	Boutique     = "boutique"
	Toilettes    = "toilettes"
	Douches      = "douches"
	CampingCar   = "camping-car"
	PiqueNique   = "pique-nique"
	Jeux         = "jeux"
)

var order = []string{Restauration, Boutique, Toilettes, Douches, CampingCar, PiqueNique, Jeux}

type Area struct {
	ID       string // « way/123 »
	Kind     string // « services » (aire de service) ou « rest_area » (aire de repos)
	Name     string
	Operator string
	Lat, Lon float64 // centre
	// Ring : contour de l'aire [lon, lat], fermé.
	Ring     [][2]float64
	Services []string
}

// Query : les aires (contours) de la zone, puis ce qui se trouve dans chacune.
func Query(b overpass.BBox) string {
	return `[out:json][timeout:180];
way["highway"~"^(services|rest_area)$"]` + b.Filter() + `->.aires;
.aires out tags geom;
.aires map_to_area->.zones;
(
  nwr(area.zones)["amenity"~"^(restaurant|fast_food|cafe|toilets|shower|sanitary_dump_station|water_point)$"];
  nwr(area.zones)["shop"];
  nwr(area.zones)["leisure"~"^(playground|picnic_table)$"];
  nwr(area.zones)["tourism"~"^(picnic_site|caravan_site)$"];
  nwr(area.zones)["amenity"="parking"]["motorhome"~"^(yes|designated)$"];
);
out tags center;`
}

func Fetch(ctx context.Context, client *http.Client, endpoint string, b overpass.BBox) ([]Area, error) {
	if b == (overpass.BBox{}) {
		return nil, errors.New("zone d'import obligatoire")
	}
	els, err := overpass.Fetch(ctx, client, endpoint, Query(b))
	if err != nil {
		return nil, err
	}
	return FromElements(els), nil
}

// FromElements : les aires utiles (un contour, et un nom ou des services) avec leurs services,
// ceux déclarés sur l'aire elle-même et ceux des équipements qu'elle contient.
func FromElements(els []overpass.Element) []Area {
	var areas []Area
	var inside []overpass.Element
	for _, e := range els {
		h := e.Tags["highway"]
		if e.Type != "way" || (h != "services" && h != "rest_area") {
			inside = append(inside, e)
			continue
		}
		ring := make([][2]float64, len(e.Geometry))
		for i, p := range e.Geometry {
			ring[i] = [2]float64{p.Lon, p.Lat}
		}
		if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
			continue // contour non fermé : pas une surface
		}
		a := Area{ID: "way/" + strconv.FormatInt(e.ID, 10), Kind: h, Name: e.Tags["name"], Operator: e.Tags["operator"], Ring: ring}
		a.Lon, a.Lat = centroid(ring)
		// Services déclarés sur l'aire elle-même ; ceux des équipements qu'elle contient s'ajoutent ensuite.
		set := map[string]bool{}
		for k, s := range map[string]string{"toilets": Toilettes, "shower": Douches, "picnic_table": PiqueNique, "sanitary_dump_station": CampingCar} {
			if v := e.Tags[k]; v != "" && v != "no" {
				set[s] = true
			}
		}
		a.Services = keys(set)
		areas = append(areas, a)
	}
	for i := range areas {
		set := map[string]bool{}
		for _, s := range areas[i].Services {
			set[s] = true
		}
		for _, x := range inside {
			lat, lon := x.Lat, x.Lon
			if x.Center != nil {
				lat, lon = x.Center.Lat, x.Center.Lon
			}
			if s := service(x.Tags); s != "" && contains(areas[i].Ring, lon, lat) {
				set[s] = true
			}
		}
		areas[i].Services = keys(set)
	}
	// Une aire de repos sans nom ni service (bas-côté élargi) n'aide pas à choisir où s'arrêter.
	return slices.DeleteFunc(areas, func(a Area) bool { return a.Name == "" && len(a.Services) == 0 })
}

func service(t map[string]string) string {
	switch {
	case t["amenity"] == "restaurant" || t["amenity"] == "fast_food" || t["amenity"] == "cafe":
		return Restauration
	case t["amenity"] == "toilets":
		return Toilettes
	case t["amenity"] == "shower":
		return Douches
	case t["amenity"] == "sanitary_dump_station" || t["amenity"] == "water_point" || t["tourism"] == "caravan_site",
		t["amenity"] == "parking" && (t["motorhome"] == "yes" || t["motorhome"] == "designated"):
		return CampingCar
	case t["shop"] != "" && t["shop"] != "no":
		return Boutique
	case t["leisure"] == "playground":
		return Jeux
	case t["leisure"] == "picnic_table" || t["tourism"] == "picnic_site":
		return PiqueNique
	}
	return ""
}

func keys(set map[string]bool) []string {
	out := []string{}
	for _, s := range order {
		if set[s] {
			out = append(out, s)
		}
	}
	return out
}

// contains : test du point dans le polygone (lancer de rayon), en degrés : exact à cette échelle.
func contains(ring [][2]float64, x, y float64) bool {
	in := false
	for i, j := 0, len(ring)-1; i < len(ring); j, i = i, i+1 {
		a, b := ring[i], ring[j]
		if (a[1] > y) != (b[1] > y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0] {
			in = !in
		}
	}
	return in
}

// centroid : moyenne des sommets (le dernier répète le premier) : suffisant pour situer une aire.
func centroid(ring [][2]float64) (lon, lat float64) {
	n := float64(len(ring) - 1)
	for _, p := range ring[:len(ring)-1] {
		lon += p[0] / n
		lat += p[1] / n
	}
	return lon, lat
}
