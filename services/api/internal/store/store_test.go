package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/fuel"
	"github.com/cytrafps/zelo/services/api/internal/irve"
	"github.com/cytrafps/zelo/services/api/internal/junction"
	"github.com/cytrafps/zelo/services/api/internal/overpass"
	"github.com/cytrafps/zelo/services/api/internal/servicearea"
	"github.com/cytrafps/zelo/services/api/internal/toll"
)

// Tests d'intégration : ils demandent une vraie base PostGIS (ZELO_TEST_DATABASE_URL),
// fournie par la CI ; sans elle, ils sont ignorés.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("ZELO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ZELO_TEST_DATABASE_URL absent : test d'intégration ignoré")
	}
	s, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

// Plusieurs répliques qui démarrent en même temps appliquent le schéma sans se bloquer.
func TestConcurrentStartup(t *testing.T) {
	url := os.Getenv("ZELO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ZELO_TEST_DATABASE_URL absent : test d'intégration ignoré")
	}
	errs := make(chan error, 4)
	for range 4 {
		go func() {
			s, err := Open(context.Background(), url)
			if err == nil {
				s.Close()
			}
			errs <- err
		}()
	}
	for range 4 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// Un signalement enregistré par une instance atteint les auditeurs de toutes les instances.
func TestReportReachesEveryInstance(t *testing.T) {
	a, b := testStore(t), testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	got := make(chan []byte, 4)
	go a.Listen(ctx, quiet, func(m []byte) { got <- m })
	go b.Listen(ctx, quiet, func(m []byte) { got <- m })
	time.Sleep(500 * time.Millisecond) // le temps que les deux LISTEN soient actifs

	// Position propre à chaque exécution : sinon le signalement d'un essai précédent (base réutilisée
	// en local) serait confirmé au lieu d'être créé.
	lat := 49.2 + float64(time.Now().UnixNano()%1000)/10_000
	r, _, err := a.AddReport(ctx, "bouchon", lat, 4.03, time.Minute, "test-a")
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2 {
		select {
		case m := <-got:
			var ev LiveEvent
			if err := json.Unmarshal(m, &ev); err != nil || ev.Type != "report" || ev.Report.ID != r.ID {
				t.Fatalf("événement %d = %s (%v)", i, m, err)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("seulement %d instance(s) sur 2 ont reçu le signalement", i)
		}
	}
}

// Une seule instance collecte ; si elle s'arrête, une autre prend le relais.
func TestSingleCollectorWithFailover(t *testing.T) {
	leaderRetry, leaderCheck = 200*time.Millisecond, 100*time.Millisecond
	s := testStore(t)
	key := time.Now().UnixNano() // verrou propre au test

	var active atomic.Int32
	var maxActive atomic.Int32
	run := func(ctx context.Context) {
		n := active.Add(1)
		for {
			m := maxActive.Load()
			if n <= m || maxActive.CompareAndSwap(m, n) {
				break
			}
		}
		<-ctx.Done()
		active.Add(-1)
	}
	leaders := make(chan int, 8)
	start := func(id int) context.CancelFunc {
		ctx, cancel := context.WithCancel(context.Background())
		go s.RunAsLeader(ctx, key, run, func(l bool) {
			if l {
				leaders <- id
			}
		})
		return cancel
	}

	stop1, stop2 := start(1), start(2)
	defer stop2()
	first := <-leaders
	time.Sleep(time.Second) // le suiveur retente plusieurs fois sans succès
	if maxActive.Load() != 1 {
		t.Fatalf("%d instances collectaient en même temps", maxActive.Load())
	}

	if first == 1 {
		stop1()
	} else {
		stop2()
		defer stop1()
	}
	select {
	case next := <-leaders:
		if next == first {
			t.Fatalf("l'instance arrêtée (%d) a repris la main", first)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("aucune instance n'a repris les collectes")
	}
	if maxActive.Load() != 1 {
		t.Fatalf("chevauchement : %d instances actives", maxActive.Load())
	}
}

func TestReportReliability(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	ttl := func(string) time.Duration { return time.Hour }
	lat, lon := 49.20, 4.10
	// Types propres à cette exécution : les signalements des exécutions précédentes ne comptent pas.
	run := fmt.Sprint(time.Now().UnixNano())
	accident, travaux := "accident-"+run, "travaux-"+run

	r, created, err := s.AddReport(ctx, accident, lat, lon, time.Hour, "alice")
	if err != nil || !created {
		t.Fatalf("création : %v (created=%v)", err, created)
	}

	// Doublon à ~50 m : c'est une confirmation, pas un nouveau signalement.
	dup, created, err := s.AddReport(ctx, accident, lat+0.0004, lon, time.Hour, "bob")
	if err != nil || created || dup.ID != r.ID || dup.Confirmations != 1 {
		t.Fatalf("doublon : %+v created=%v err=%v", dup, created, err)
	}
	// Autre type au même endroit : signalement distinct.
	if other, created, err := s.AddReport(ctx, travaux, lat, lon, time.Hour, "bob"); err != nil || !created || other.ID == r.ID {
		t.Fatalf("autre type : %+v created=%v err=%v", other, created, err)
	}

	if _, _, err := s.Vote(ctx, r.ID, "alice", false, ttl); !errors.Is(err, ErrOwnReport) {
		t.Fatalf("vote sur son signalement : %v", err)
	}

	// Une confirmation prolonge : il reste au moins ttl/2.
	conf, _, err := s.Vote(ctx, r.ID, "carol", true, ttl)
	if err != nil || conf.Confirmations != 2 || time.Until(conf.ExpiresAt) < 29*time.Minute {
		t.Fatalf("confirmation : %+v err=%v", conf, err)
	}

	// Bob change d'avis : son vote est remplacé, pas ajouté.
	if v, _, err := s.Vote(ctx, r.ID, "bob", false, ttl); err != nil || v.Confirmations != 1 || v.Denials != 1 {
		t.Fatalf("changement d'avis : %+v err=%v", v, err)
	}
	// 2 « plus là » contre 1 confirmation : retiré.
	if v, removed, err := s.Vote(ctx, r.ID, "dave", false, ttl); err != nil || !removed {
		t.Fatalf("aurait dû être retiré : %+v err=%v", v, err)
	}
	if _, _, err := s.Vote(ctx, r.ID, "frank", true, ttl); !errors.Is(err, ErrReportNotFound) {
		t.Fatalf("vote sur un signalement retiré : %v", err)
	}
}

// Prix d'une station : le moins cher de ses points, « dès » s'ils diffèrent ; gratuite si tous le sont.
func TestChargeStationPrice(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	price := func(v float64) *float64 { return &v }
	pt := func(id, station string, p *float64, free bool) irve.ChargePoint {
		return irve.ChargePoint{ID: id, StationID: station, StationName: station, Lat: 49.2501, Lon: 4.0301, PowerKW: 22, PriceKWh: p, Free: free}
	}
	if err := s.SaveChargePoints(ctx, []irve.ChargePoint{
		pt("T-PRIX-1", "T-PRIX-A", price(0.59), false),
		pt("T-PRIX-2", "T-PRIX-A", price(0.36), false),
		pt("T-PRIX-3", "T-PRIX-B", nil, false),
		pt("T-PRIX-4", "T-PRIX-C", nil, true),
	}); err != nil {
		t.Fatal(err)
	}
	stations, err := s.ChargeStations(ctx, BBox{4.03, 49.25, 4.0302, 49.2502}, 50)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]*ChargePrice{}
	for _, c := range stations {
		got[c.ID] = c.Price
	}
	if p := got["T-PRIX-A"]; p == nil || p.KWh < 0.3599 || p.KWh > 0.3601 || !p.From || p.Free {
		t.Errorf("A : %+v", p)
	}
	if p := got["T-PRIX-B"]; p != nil {
		t.Errorf("B sans prix publié : %+v", p)
	}
	if p := got["T-PRIX-C"]; p == nil || !p.Free {
		t.Errorf("C gratuite : %+v", p)
	}
}

// Le flux dynamique est national : seuls les points connus gardent un état, le plus récent.
func TestChargeStatusKeepsKnownPoints(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.SaveChargePoints(ctx, []irve.ChargePoint{{ID: "T-ST-1", StationID: "T-ST", Lat: 49.26, Lon: 4.04}}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.SaveChargeStatus(ctx, []irve.Status{
		{ID: "T-ST-1", State: "en_service", Occupancy: "occupe", ObservedAt: now.Add(-time.Minute)},
		{ID: "T-ST-1", State: "en_service", Occupancy: "libre", ObservedAt: now}, // doublon du flux : le plus récent gagne
		{ID: "T-ST-INCONNU", State: "en_service", Occupancy: "libre", ObservedAt: now},
	}); err != nil {
		t.Fatal(err)
	}
	var occupancy string
	if err := s.db.QueryRow(ctx, `SELECT occupancy FROM charge_status WHERE id = 'T-ST-1'`).Scan(&occupancy); err != nil || occupancy != "libre" {
		t.Fatalf("T-ST-1 : %q (%v), attendu libre", occupancy, err)
	}
	var unknown int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM charge_status WHERE id = 'T-ST-INCONNU'`).Scan(&unknown); err != nil || unknown != 0 {
		t.Fatalf("point inconnu enregistré (%d, %v)", unknown, err)
	}
}

// Une station inchangée n'est pas réécrite à chaque collecte ; une adresse corrigée l'est.
func TestFuelUpsertSkipsUnchanged(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	st := fuel.Station{ID: "T-FUEL-1", Lat: 49.27, Lon: 4.05, Address: "1 rue A", City: "Reims", Postcode: "51100"}
	version := func() (x string) {
		t.Helper()
		if err := s.db.QueryRow(ctx, `SELECT xmin::text FROM fuel_station WHERE id = $1`, st.ID).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}
	if err := s.SaveFuel(ctx, []fuel.Station{st}); err != nil {
		t.Fatal(err)
	}
	v1 := version()
	if err := s.SaveFuel(ctx, []fuel.Station{st}); err != nil {
		t.Fatal(err)
	}
	if v2 := version(); v2 != v1 {
		t.Fatalf("station inchangée réécrite (xmin %s → %s)", v1, v2)
	}
	st.Address = "2 rue A"
	if err := s.SaveFuel(ctx, []fuel.Station{st}); err != nil {
		t.Fatal(err)
	}
	if v3 := version(); v3 == v1 {
		t.Fatal("adresse corrigée non enregistrée")
	}
}

// Liste coupée par la limite : on garde les stations les plus proches du centre de la zone.
func TestFuelStationsNearestFirst(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	at := func(id string, lon float64) fuel.Station { return fuel.Station{ID: id, Lat: 49.30, Lon: lon} }
	if err := s.SaveFuel(ctx, []fuel.Station{at("T-KNN-BORD", 4.100), at("T-KNN-CENTRE", 4.1101), at("T-KNN-AUTRE-BORD", 4.119)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.FuelStations(ctx, BBox{4.10, 49.29, 4.12, 49.31}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "T-KNN-CENTRE" {
		t.Fatalf("limite 1 : %+v, attendu T-KNN-CENTRE", got)
	}
}

// Feux et stops : remplacés à chaque import, cherchés le long du tracé.
func TestControlsAlong(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.SaveControls(ctx, []junction.Control{
		{ID: "node/T1", Kind: "feu", Lat: 49.2800, Lon: 4.0500},
		{ID: "node/T2", Kind: "stop", Lat: 49.2810, Lon: 4.0500}, // ~110 m plus au nord
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ControlsAlong(ctx, [][2]float64{{4.0490, 49.2800}, {4.0510, 49.2800}}, 10)
	if err != nil || len(got) != 1 || got[0].ID != "node/T1" || got[0].Kind != "feu" {
		t.Fatalf("%+v %v", got, err)
	}
	// Nouvel import sans T1 : il disparaît.
	if err := s.SaveControls(ctx, []junction.Control{{ID: "node/T2", Kind: "stop", Lat: 49.2810, Lon: 4.0500}}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.ControlsAlong(ctx, [][2]float64{{4.0490, 49.2800}, {4.0510, 49.2800}}, 10); len(got) != 0 {
		t.Fatalf("feu supprimé d'OSM encore là : %+v", got)
	}
}

// Aires : enregistrées depuis OSM, retrouvées le long d'un tracé avec le carburant de leur station.
func TestAreasAlong(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	ring := [][2]float64{{4.30, 49.30}, {4.31, 49.30}, {4.31, 49.31}, {4.30, 49.31}, {4.30, 49.30}}
	if err := s.SaveAreas(ctx, []servicearea.Area{
		{ID: "way/T1", Kind: "services", Name: "Aire test", Ring: ring, Lat: 49.305, Lon: 4.305, Services: []string{"restauration", "douches"}},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := s.SaveFuel(ctx, []fuel.Station{
		{ID: "T-AIRE-1", Lat: 49.305, Lon: 4.305, Prices: []fuel.Price{{Fuel: "Gazole", Value: 1.789, UpdatedAt: now}, {Fuel: "SP98", Value: 1.999, UpdatedAt: now}}},
		{ID: "T-AIRE-2", Lat: 49.306, Lon: 4.306, Prices: []fuel.Price{{Fuel: "Gazole", Value: 1.759, UpdatedAt: now}}},
	}); err != nil {
		t.Fatal(err)
	}
	line := [][2]float64{{4.3115, 49.29}, {4.3115, 49.32}} // longe l'aire à l'est, à ~40 m
	got, err := s.AreasAlong(ctx, line, 400)
	if err != nil || len(got) != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	a := got[0]
	if a.Name != "Aire test" || a.Fuel["Gazole"] != 1.759 || a.Fuel["SP98"] != 1.999 || a.ChargeTotal != 0 || len(a.Services) != 2 {
		t.Fatalf("%+v", a)
	}
	if far, _ := s.AreasAlong(ctx, [][2]float64{{4.40, 49.29}, {4.40, 49.32}}, 400); len(far) != 0 {
		t.Fatalf("aire à 6 km retenue : %+v", far)
	}
}

// Les contours réels de la Marne s'enregistrent tous (aucun perdu à la validation).
func TestSaveAreasMarne(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	f, err := os.Open("../servicearea/testdata/marne.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	els, err := overpass.Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	areas := servicearea.FromElements(els)
	if err := s.SaveAreas(ctx, areas); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM service_area`).Scan(&n); err != nil || n != len(areas) {
		t.Fatalf("%d aires enregistrées sur %d (%v)", n, len(areas), err)
	}
}

// Accès et usage : une station dont tous les points sont réservés l'est ; la hauteur la plus
// basse l'emporte ; l'accès PMR d'un seul point suffit.
func TestChargeStationAccess(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	h := func(v float64) *float64 { return &v }
	pt := func(id, station string, reserved bool, pmr string, height *float64, twoWheels bool) irve.ChargePoint {
		return irve.ChargePoint{ID: id, StationID: station, StationName: station, Lat: 49.2601, Lon: 4.0401, PowerKW: 22,
			Reserved: reserved, PMR: pmr, MaxHeight: height, TwoWheels: twoWheels, Placement: "parking"}
	}
	if err := s.SaveChargePoints(ctx, []irve.ChargePoint{
		pt("T-ACC-1", "T-ACC-HOTEL", true, "non", h(2.1), false),
		pt("T-ACC-2", "T-ACC-HOTEL", true, "non", h(1.9), false),
		pt("T-ACC-3", "T-ACC-PUBLIC", false, "accessible", nil, true),
		pt("T-ACC-4", "T-ACC-PUBLIC", true, "", nil, false),
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ChargeStations(ctx, BBox{4.04, 49.26, 4.0402, 49.2602}, 50)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]ChargeStation{}
	for _, c := range got {
		by[c.ID] = c
	}
	hotel, public := by["T-ACC-HOTEL"], by["T-ACC-PUBLIC"]
	if !hotel.Reserved || hotel.PMR == nil || *hotel.PMR || hotel.MaxHeight == nil || *hotel.MaxHeight < 1.89 || *hotel.MaxHeight > 1.91 {
		t.Errorf("hôtel : %+v", hotel)
	}
	if public.Reserved || public.PMR == nil || !*public.PMR || !public.TwoWheels || public.Placement != "parking" {
		t.Errorf("publique : %+v", public)
	}
}

// Historique des prix : le prix d'un jour est le dernier changement à cette date ou avant ;
// un nouvel import le jour même remplace le prix du jour ; un carburant retiré sort de la moyenne.
func TestFuelTrend(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	paris, _ := time.LoadLocation("Europe/Paris")
	noon := func(daysAgo int) time.Time {
		y, m, d := time.Now().In(paris).AddDate(0, 0, -daysAgo).Date()
		return time.Date(y, m, d, 12, 0, 0, 0, paris)
	}
	day := func(daysAgo int) string { return noon(daysAgo).Format("2006-01-02") }
	// Collecte commencée il y a 20 jours (la base de test, elle, vient d'être créée).
	if _, err := s.db.Exec(ctx, `UPDATE fuel_history SET started = $1::date`, day(20)); err != nil {
		t.Fatal(err)
	}
	box := BBox{5.50, 45.00, 5.52, 45.02} // à l'écart des autres tests
	if _, err := s.db.Exec(ctx, `DELETE FROM fuel_station WHERE id LIKE 'T-TREND-%'`); err != nil {
		t.Fatal(err)
	}
	e10 := func(v float64, at time.Time) []fuel.Price {
		return []fuel.Price{{Fuel: "E10", Value: v, UpdatedAt: at}}
	}
	a := fuel.Station{ID: "T-TREND-A", Lat: 45.01, Lon: 5.51, Prices: e10(1.800, noon(10))}
	b := fuel.Station{ID: "T-TREND-B", Lat: 45.011, Lon: 5.511, Prices: e10(1.700, noon(3))}
	c := fuel.Station{ID: "T-TREND-C", Lat: 45.012, Lon: 5.512, Prices: e10(1.500, noon(9))}
	save := func(st ...fuel.Station) {
		t.Helper()
		if err := s.SaveFuel(ctx, st); err != nil {
			t.Fatal(err)
		}
	}
	save(a, b, c)
	a.Prices = e10(1.760, noon(1))
	save(a, b, c)
	a.Prices = e10(1.740, noon(1).Add(time.Hour))
	c.Prices = nil // C ne vend plus d'E10
	save(a, b, c)

	got, err := s.FuelTrend(ctx, box, "E10", 12)
	if err != nil {
		t.Fatal(err)
	}
	type want struct {
		avg, min, max float64
		n             int
		week          string
	}
	wants := map[string]want{
		day(10): {1.800, 1.800, 1.800, 1, "–"},
		day(9):  {1.650, 1.500, 1.800, 2, "–"},
		day(3):  {1.667, 1.500, 1.800, 3, "0.000"},  // A et C sans changement depuis 7 jours, B inconnu alors
		day(1):  {1.647, 1.500, 1.740, 3, "-0.030"}, // A : 1,800 → 1,740, C stable : −0,06 et 0
		day(0):  {1.720, 1.700, 1.740, 2, "-0.060"}, // C retiré aujourd'hui ; A seul connu 7 jours plus tôt
	}
	if len(got) != 11 || got[0].Day != day(10) || got[10].Day != day(0) {
		t.Fatalf("jours : %+v", got)
	}
	for _, g := range got {
		w, ok := wants[g.Day]
		if !ok {
			continue
		}
		week := "–"
		if g.Week != nil {
			week = fmt.Sprintf("%.3f", *g.Week)
		}
		if fmt.Sprintf("%.3f %.3f %.3f %d %s", g.Avg, g.Min, g.Max, g.Stations, week) != fmt.Sprintf("%.3f %.3f %.3f %d %s", w.avg, w.min, w.max, w.n, w.week) {
			t.Errorf("%s : %+v (semaine %s), attendu %+v", g.Day, g, week, w)
		}
		if !g.Complete {
			t.Errorf("%s : collecte commencée il y a 20 jours, jour complet attendu", g.Day)
		}
	}
}

// Postes de péage : ceux sous le tracé, dans l'ordre de passage, pas ceux d'à côté.
func TestTollGaresAlong(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	at := func(id string, net, gare int, lon float64, lat float64) TollBooth {
		return TollBooth{ID: id, Gare: toll.Gare{Net: net, Index: gare}, Lat: lat, Lon: lon}
	}
	if err := s.SaveTollBooths(ctx, []TollBooth{
		at("T-PEAGE-FIN", 2, 9, 5.62, 45.10),
		at("T-PEAGE-DEBUT", 2, 5, 5.60, 45.10),
		at("T-PEAGE-COTE", 2, 7, 5.61, 45.1005), // ~55 m du tracé : la chaussée d'en face
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.TollGaresAlong(ctx, [][2]float64{{5.59, 45.10}, {5.63, 45.10}}, 15)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Index != 5 || got[1].Index != 9 {
		t.Fatalf("postes franchis : %+v", got)
	}
}
