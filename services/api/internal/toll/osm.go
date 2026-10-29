package toll

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// Booth : un poste de péage d'OpenStreetMap, avec la sortie d'autoroute la plus proche (son
// numéro et son nom, qui désignent la gare dans la grille quand le poste n'est pas nommé).
type Booth struct {
	ID       string // « node/123 », « way/456 »
	Name     string
	Lat, Lon float64
	Exit     string // ref de la sortie (« 22 »), ou vide
	ExitName string
}

// exitWithin (m) : une sortie plus loin que ça n'est pas celle du poste.
const exitWithin = 2000

// Query : postes de péage et sorties d'autoroute numérotées de la zone.
func Query(b overpass.BBox) string {
	f := b.Filter()
	return `[out:json][timeout:120];(nwr["barrier"="toll_booth"]` + f + `;node["highway"="motorway_junction"]["ref"]` + f + `;);out center tags;`
}

func Fetch(ctx context.Context, client *http.Client, endpoint string, b overpass.BBox) ([]Booth, error) {
	if b == (overpass.BBox{}) {
		return nil, errors.New("zone d'import obligatoire : Overpass ne sert pas la France entière")
	}
	els, err := overpass.Fetch(ctx, client, endpoint, Query(b))
	if err != nil {
		return nil, err
	}
	return FromElements(els), nil
}

func FromElements(els []overpass.Element) []Booth {
	type exit struct {
		lat, lon  float64
		ref, name string
	}
	var exits []exit
	var booths []Booth
	for _, e := range els {
		lat, lon := e.Lat, e.Lon
		if e.Center != nil {
			lat, lon = e.Center.Lat, e.Center.Lon
		}
		if lat == 0 && lon == 0 {
			continue
		}
		switch {
		case e.Tags["highway"] == "motorway_junction":
			exits = append(exits, exit{lat, lon, e.Tags["ref"], e.Tags["name"]})
		case e.Tags["barrier"] == "toll_booth":
			booths = append(booths, Booth{ID: e.Type + "/" + strconv.FormatInt(e.ID, 10), Name: e.Tags["name"], Lat: lat, Lon: lon})
		}
	}
	for i := range booths {
		best := math.Inf(1)
		for _, x := range exits {
			if d := meters(booths[i].Lat, booths[i].Lon, x.lat, x.lon); d < best && d <= exitWithin {
				best, booths[i].Exit, booths[i].ExitName = d, x.ref, x.name
			}
		}
	}
	return booths
}

func meters(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000
	φ1, φ2 := lat1*math.Pi/180, lat2*math.Pi/180
	dφ, dλ := φ2-φ1, (lon2-lon1)*math.Pi/180
	a := math.Sin(dφ/2)*math.Sin(dφ/2) + math.Cos(φ1)*math.Cos(φ2)*math.Sin(dλ/2)*math.Sin(dλ/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
