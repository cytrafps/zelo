package toll

import (
	"testing"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

// Réponse Overpass « out; » : nœuds avec coordonnées ; la sortie numérotée la plus proche (2 km au
// plus) est rattachée au poste, pas une plus lointaine.
func TestFromElements(t *testing.T) {
	els := []overpass.Element{
		{Type: "node", ID: 1, Lat: 49.2201, Lon: 3.9500, Tags: map[string]string{"barrier": "toll_booth"}},
		{Type: "node", ID: 2, Lat: 49.2210, Lon: 3.9520, Tags: map[string]string{"highway": "motorway_junction", "ref": "22", "name": "Reims-Ouest"}},
		{Type: "node", ID: 3, Lat: 49.3000, Lon: 3.9500, Tags: map[string]string{"highway": "motorway_junction", "ref": "99"}},
		{Type: "node", ID: 4, Lat: 49.2600, Lon: 4.0000, Tags: map[string]string{"barrier": "toll_booth", "name": "Péage de Taissy"}},
	}
	b := FromElements(els)
	if len(b) != 2 || b[0].ID != "node/1" || b[0].Exit != "22" || b[0].ExitName != "Reims-Ouest" || b[1].Exit != "" || b[1].Name != "Péage de Taissy" {
		t.Fatalf("postes : %+v", b)
	}
}
