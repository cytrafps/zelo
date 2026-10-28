package junction

import (
	"strings"
	"testing"

	"github.com/cytrafps/zelo/services/api/internal/overpass"
)

func TestFromElements(t *testing.T) {
	els, err := overpass.Parse(strings.NewReader(`{"elements":[
		{"type":"node","id":1,"lat":49.25,"lon":4.03,"tags":{"highway":"traffic_signals"}},
		{"type":"node","id":2,"lat":49.25,"lon":4.03,"tags":{"highway":"traffic_signals","traffic_signals":"crossing_only"}},
		{"type":"node","id":3,"lat":49.26,"lon":4.04,"tags":{"highway":"stop","direction":"forward"}},
		{"type":"node","id":4,"lat":49.26,"lon":4.04,"tags":{"highway":"give_way"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	got := FromElements(els)
	if len(got) != 3 || got[0] != (Control{"node/1", "feu", 49.25, 4.03}) || got[1].Kind != "stop" || got[2].Kind != "cédez" {
		t.Fatalf("%+v", got)
	}
}

func TestQuery(t *testing.T) {
	q := Query(overpass.BBox{MinLon: 3.85, MinLat: 49.15, MaxLon: 4.25, MaxLat: 49.35})
	if !strings.Contains(q, `node["highway"="stop"](49.15,3.85,49.35,4.25)`) {
		t.Fatal(q)
	}
}
