// Package junction lit les feux tricolores et les stops d'OpenStreetMap (via Overpass) : ils
// donnent au guidage ses repères, « au feu, tournez à droite ».
package junction

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

type Control struct {
	ID       string // « node/123 »
	Kind     string // « feu », « stop »
	Lat, Lon float64
}

// Query : feux et stops de la zone. Les feux réservés aux piétons (traversée seule) ne marquent
// pas un carrefour : ils sont écartés.
func Query(b overpass.BBox) string {
	f := b.Filter()
	return `[out:json][timeout:90];(node["highway"="traffic_signals"]` + f + `;node["highway"="stop"]` + f + `;);out;`
}

func Fetch(ctx context.Context, client *http.Client, endpoint string, b overpass.BBox) ([]Control, error) {
	if b == (overpass.BBox{}) {
		return nil, errors.New("zone d'import obligatoire : Overpass ne sert pas la France entière")
	}
	els, err := overpass.Fetch(ctx, client, endpoint, Query(b))
	if err != nil {
		return nil, err
	}
	return FromElements(els), nil
}

func FromElements(els []overpass.Element) []Control {
	out := make([]Control, 0, len(els))
	for _, e := range els {
		if e.Type != "node" || (e.Lat == 0 && e.Lon == 0) {
			continue
		}
		var kind string
		switch e.Tags["highway"] {
		case "traffic_signals":
			if e.Tags["traffic_signals"] == "crossing_only" {
				continue
			}
			kind = "feu"
		case "stop":
			kind = "stop"
		default:
			continue
		}
		out = append(out, Control{ID: "node/" + strconv.FormatInt(e.ID, 10), Kind: kind, Lat: e.Lat, Lon: e.Lon})
	}
	return out
}
