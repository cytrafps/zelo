package transit

import (
	"os"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

// tripAt : la course qui part de stop à hhmm le mardi 3 novembre, et le rang de cet arrêt.
func tripAt(t *testing.T, tt *Timetable, stop string, h, m int) (string, int32) {
	t.Helper()
	for _, tr := range tt.trips {
		if !tt.days[tr.service]["20261103"] {
			continue
		}
		for _, c := range tr.calls {
			if c.stop == stop && c.dep == h*3600+m*60 && tt.Lines[tr.line].Mode == "tram" {
				return tr.id, c.seq
			}
		}
	}
	t.Fatalf("aucun tram à %02d:%02d", h, m)
	return "", 0
}

func feed(t *testing.T, updates ...*gtfs.TripUpdate) *Realtime {
	t.Helper()
	f := &gtfs.FeedMessage{Header: &gtfs.FeedHeader{GtfsRealtimeVersion: proto.String("2.0"), Timestamp: proto.Uint64(uint64(time.Now().Unix()))}}
	for i, u := range updates {
		f.Entity = append(f.Entity, &gtfs.FeedEntity{Id: proto.String(string(rune('a' + i))), TripUpdate: u})
	}
	b, err := proto.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	rt, err := ParseRealtime(b)
	if err != nil {
		t.Fatal(err)
	}
	return rt
}

// Le tram de 8 h 05 annonce 4 min de retard au départ : on le prend à 8 h 09, son arrivée est
// décalée d'autant, et le trajet est marqué temps réel. Supprimé, on prend celui de 8 h 10.
func TestRealtime(t *testing.T) {
	tt := citura(t)
	id, seq := tripAt(t, tt, neufchatel, 8, 5)
	static := tt.Plan([]Access{{neufchatel, 0}}, []Access{{opera, 0}}, time.Date(2026, 11, 3, 8, 3, 0, 0, Paris), time.Hour, 1, nil)[0].Legs[0]
	if static.Depart.Format("15:04") != "08:05" {
		t.Fatalf("théorique : %+v", static)
	}

	late := time.Date(2026, 11, 3, 8, 9, 0, 0, Paris).Unix()
	rt := feed(t, &gtfs.TripUpdate{
		Trip: &gtfs.TripDescriptor{TripId: proto.String(id)},
		StopTimeUpdate: []*gtfs.TripUpdate_StopTimeUpdate{{
			StopSequence: proto.Uint32(uint32(seq)),
			Departure:    &gtfs.TripUpdate_StopTimeEvent{Time: proto.Int64(late)},
		}},
	})
	// Le tram retardé reste le plus rapide en partant juste après 8 h 05.
	after := time.Date(2026, 11, 3, 8, 3, 0, 0, Paris)
	leg := tt.Plan([]Access{{neufchatel, 0}}, []Access{{opera, 0}}, after, time.Hour, 1, rt)[0].Legs[0]
	if !leg.Realtime || leg.Depart.Unix() != late || leg.Arrive.Sub(static.Arrive) != 4*time.Minute {
		t.Fatalf("retard non appliqué : %+v (théorique %+v)", leg, static)
	}

	gone := feed(t, &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{TripId: proto.String(id), ScheduleRelationship: gtfs.TripDescriptor_CANCELED.Enum()}})
	for _, j := range tt.Plan([]Access{{neufchatel, 0}}, []Access{{opera, 0}}, after, time.Hour, 3, gone) {
		for _, l := range j.Legs {
			if l.From.ID == neufchatel && l.Depart.Equal(static.Depart) && l.Line != nil && l.Line.Mode == "tram" {
				t.Fatalf("course supprimée encore proposée : %+v", l)
			}
		}
	}

	// Un flux trop ancien est ignoré : horaires théoriques.
	rt.At = time.Now().Add(-10 * time.Minute)
	if leg := tt.Plan([]Access{{neufchatel, 0}}, []Access{{opera, 0}}, after, time.Hour, 1, rt)[0].Legs[0]; leg.Realtime || !leg.Depart.Equal(static.Depart) {
		t.Fatalf("flux périmé appliqué : %+v", leg)
	}
}

// Flux réel du 28 octobre (17 h 16) : heures absolues par rang d'arrêt pour 240 courses.
func TestParseRealtimeCitura(t *testing.T) {
	b, err := os.ReadFile("testdata/citura-rt-28-octobre.pb")
	if err != nil {
		t.Fatal(err)
	}
	rt, err := ParseRealtime(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(rt.times) != 240 || rt.At.Year() != 2026 {
		t.Fatalf("%d courses, émis le %v", len(rt.times), rt.At)
	}
	for id, stops := range rt.times {
		for seq, x := range stops {
			if x[0] == 0 && x[1] == 0 {
				t.Fatalf("%s rang %d : aucune heure", id, seq)
			}
		}
	}
	if _, err := ParseRealtime([]byte("pas du protobuf")); err == nil {
		t.Fatal("flux illisible accepté")
	}
}
