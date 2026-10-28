package vigilance

import (
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

// Vraie carte du 28 octobre 2026, réduite à la Marne et aux Ardennes : tout est vert.
func TestParse(t *testing.T) {
	f, err := os.Open("testdata/encours-28-octobre.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	m, err := Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Spans["51"]) == 0 || m.Updated.IsZero() {
		t.Fatalf("%+v", m)
	}
	if a := m.At("51", time.Date(2026, 10, 28, 20, 0, 0, 0, time.UTC)); a != nil {
		t.Errorf("vigilance verte attendue : %+v", a)
	}
}

func TestAt(t *testing.T) {
	m, err := Parse(strings.NewReader(`{"product":{"update_time":"2026-01-10T05:00:00Z","periods":[{"timelaps":{"domain_ids":[
		{"domain_id":"51","phenomenon_items":[
			{"phenomenon_id":"5","timelaps_items":[{"begin_time":"2026-01-10T00:00:00Z","end_time":"2026-01-10T12:00:00Z","color_id":3}]},
			{"phenomenon_id":"7","timelaps_items":[{"begin_time":"2026-01-10T00:00:00Z","end_time":"2026-01-10T23:00:00Z","color_id":3}]},
			{"phenomenon_id":"1","timelaps_items":[{"begin_time":"2026-01-10T00:00:00Z","end_time":"2026-01-10T23:00:00Z","color_id":2}]}]}]}}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	a := m.At("51", time.Date(2026, 1, 10, 8, 0, 0, 0, time.UTC))
	if a == nil || a.Color != "orange" || !slices.Equal(a.Phenomena, []string{"neige-verglas", "grand froid"}) {
		t.Fatalf("%+v", a)
	}
	if a := m.At("51", time.Date(2026, 1, 10, 15, 0, 0, 0, time.UTC)); a == nil || !slices.Equal(a.Phenomena, []string{"grand froid"}) {
		t.Errorf("l'après-midi : %+v", a)
	}
	if m.At("08", time.Date(2026, 1, 10, 8, 0, 0, 0, time.UTC)) != nil || (*Map)(nil).At("51", time.Now()) != nil {
		t.Error("autre département ou pas de carte : rien")
	}
}
