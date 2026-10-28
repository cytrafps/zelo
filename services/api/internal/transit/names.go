package transit

import (
	"context"
	"math"
	"net/http"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// NameMatch : un arrêt OSM plus loin que ça ne nomme pas cette station.
const NameMatch = 300.0

// FetchNames : noms des arrêts de tram et de bus d'OpenStreetMap dans l'emprise des stations.
func (t *Timetable) FetchNames(ctx context.Context, client *http.Client, endpoint string) ([]overpass.Element, error) {
	b := overpass.BBox{MinLon: math.Inf(1), MinLat: math.Inf(1), MaxLon: math.Inf(-1), MaxLat: math.Inf(-1)}
	for _, s := range t.Stops {
		b.MinLon, b.MinLat = min(b.MinLon, s.Lon), min(b.MinLat, s.Lat)
		b.MaxLon, b.MaxLat = max(b.MaxLon, s.Lon), max(b.MaxLat, s.Lat)
	}
	f := b.Filter()
	q := `[out:json][timeout:60];(node["highway"="bus_stop"]["name"]` + f + `;node["railway"="tram_stop"]["name"]` + f +
		`;node["public_transport"]["name"]` + f + `;);out;`
	return overpass.Fetch(ctx, client, endpoint, q)
}

// Rename donne aux stations le nom d'OSM, accentué (« Opéra-Cathédrale »), quand un arrêt OSM
// proche porte le même nom à l'écriture près ; sinon le nom GTFS reste (Citura écrit en capitales
// sans accents). Renvoie le nombre de stations renommées.
func (t *Timetable) Rename(osm []overpass.Element) int {
	byName := map[string][]overpass.Element{}
	for _, e := range osm {
		k := normalize(e.Tags["name"])
		byName[k] = append(byName[k], e)
	}
	n := 0
	for i, s := range t.Stops {
		best, bestD := "", NameMatch
		for _, e := range byName[normalize(s.Name)] {
			name := e.Tags["name"]
			if d := Distance(s.Lat, s.Lon, e.Lat, e.Lon); d < bestD {
				best, bestD = tidy(name), d
			}
		}
		if best != "" && best != s.Name {
			t.Stops[i].Name = best
			n++
		}
	}
	return n
}

var abbrev = map[string]string{"ST": "SAINT", "STE": "SAINTE", "AV": "AVENUE", "BD": "BOULEVARD", "PL": "PLACE"}

// normalize : capitales sans accents ni ponctuation, abréviations courantes développées.
func normalize(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	plain, _, _ := transform.String(t, s)
	words := strings.FieldsFunc(strings.ToUpper(plain), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	for i, w := range words {
		if long, ok := abbrev[w]; ok {
			words[i] = long
		}
	}
	return strings.Join(words, " ")
}

// tidy : « Opéra - Cathédrale » s'écrit « Opéra-Cathédrale », comme sur le plan du réseau.
func tidy(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(s, " - ", "-")), " ")
}
