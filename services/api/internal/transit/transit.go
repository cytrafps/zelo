// Package transit lit les horaires théoriques du réseau Citura (GTFS : tram et bus) et calcule
// les trajets en transport en commun d'un parking relais vers une destination, correspondances
// comprises (voir Plan).
package transit

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// FeedURL : GTFS de Grand Reims Mobilités, publié sur transport.data.gouv.fr.
const FeedURL = "https://transport.data.gouv.fr/resources/80594/download"

// Paris : les heures GTFS sont à l'heure locale du réseau.
var Paris = mustLoad("Europe/Paris")

func mustLoad(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

// Stop : un arrêt (station mère GTFS, qui regroupe les quais des deux sens).
type Stop struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

type call struct {
	stop string // station mère
	dep  int    // secondes depuis minuit du jour de service (peut dépasser 24 h)
	arr  int
	seq  int32 // stop_sequence GTFS, que le temps réel référence
}

type trip struct {
	id       string
	service  string
	line     string
	headsign string
	calls    []call
}

// Line : une ligne et sa couleur.
type Line struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Mode      string `json:"mode"`      // « tram » ou « bus »
	Color     string `json:"color"`     // hexadécimal sans « # »
	TextColor string `json:"textColor"` // idem
}

// Timetable : tram (route_type 0, ou 1 tel que Citura déclare son tram) et bus (3).
type Timetable struct {
	Stops []Stop
	Lines map[string]Line
	trips []trip
	// days[service] : jours de service (AAAAMMJJ) où il circule.
	days map[string]map[string]bool

	index map[string]int32 // station → indice dans Stops
	foot  [][]footpath     // correspondances à pied entre stations proches

	mu    sync.Mutex
	conns map[string][]conn // connexions d'un jour de service, triées par départ

	// Connexions corrigées par le dernier flux temps réel appliqué (voir effective).
	rtFor   *Realtime
	rtDay   string
	rtConns []conn
	rtDelay []int32 // 1 : course suivie en temps réel
}

// Fetch télécharge et lit le GTFS.
func Fetch(ctx context.Context, client *http.Client, url string) (*Timetable, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gtfs: HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	return Parse(body)
}

// Parse lit une archive GTFS.
func Parse(archive []byte) (*Timetable, error) {
	z, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, fmt.Errorf("gtfs: %w", err)
	}
	files := map[string]*zip.File{}
	for _, f := range z.File {
		files[f.Name] = f
	}
	read := func(name string, required bool, row func(get func(string) string) error) error {
		f, ok := files[name]
		if !ok {
			if required {
				return fmt.Errorf("gtfs: %s absent", name)
			}
			return nil
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		r := csv.NewReader(rc)
		r.ReuseRecord = true
		head, err := r.Read()
		if err != nil {
			return fmt.Errorf("gtfs: %s: %w", name, err)
		}
		col := map[string]int{}
		for i, h := range head {
			col[strings.TrimPrefix(strings.TrimSpace(h), "\ufeff")] = i
		}
		for {
			rec, err := r.Read()
			if errors.Is(err, io.EOF) {
				return nil
			}
			if err != nil {
				return fmt.Errorf("gtfs: %s: %w", name, err)
			}
			get := func(k string) string {
				if i, ok := col[k]; ok && i < len(rec) {
					return rec[i]
				}
				return ""
			}
			if err := row(get); err != nil {
				return err
			}
		}
	}

	t := &Timetable{Lines: map[string]Line{}, days: map[string]map[string]bool{}}
	if err := read("routes.txt", true, func(get func(string) string) error {
		mode := map[string]string{"0": "tram", "1": "tram", "3": "bus"}[get("route_type")]
		if mode != "" {
			id := get("route_id")
			t.Lines[id] = Line{ID: id, Name: get("route_short_name"), Mode: mode, Color: get("route_color"), TextColor: get("route_text_color")}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	parent := map[string]string{}
	all := map[string]Stop{}
	if err := read("stops.txt", true, func(get func(string) string) error {
		id := get("stop_id")
		lat, _ := strconv.ParseFloat(get("stop_lat"), 64)
		lon, _ := strconv.ParseFloat(get("stop_lon"), 64)
		all[id] = Stop{ID: id, Name: get("stop_name"), Lat: lat, Lon: lon}
		if p := get("parent_station"); p != "" {
			parent[id] = p
		}
		return nil
	}); err != nil {
		return nil, err
	}
	station := func(id string) string {
		if p, ok := parent[id]; ok {
			return p
		}
		return id
	}

	tripIndex := map[string]int{}
	if err := read("trips.txt", true, func(get func(string) string) error {
		if _, ok := t.Lines[get("route_id")]; ok {
			tripIndex[get("trip_id")] = len(t.trips)
			t.trips = append(t.trips, trip{id: get("trip_id"), service: get("service_id"), line: get("route_id"), headsign: get("trip_headsign")})
		}
		return nil
	}); err != nil {
		return nil, err
	}
	seq := map[int][]int{}
	if err := read("stop_times.txt", true, func(get func(string) string) error {
		i, ok := tripIndex[get("trip_id")]
		if !ok {
			return nil
		}
		dep, err1 := clock(get("departure_time"))
		arr, err2 := clock(get("arrival_time"))
		if err := errors.Join(err1, err2); err != nil {
			return err
		}
		n, _ := strconv.Atoi(get("stop_sequence"))
		t.trips[i].calls = append(t.trips[i].calls, call{stop: station(get("stop_id")), dep: dep, arr: arr, seq: int32(n)})
		seq[i] = append(seq[i], n)
		return nil
	}); err != nil {
		return nil, err
	}
	served := map[string]bool{}
	for i := range t.trips {
		// Dans l'ordre de passage, quel que soit l'ordre du fichier.
		calls, order := t.trips[i].calls, seq[i]
		idx := make([]int, len(calls))
		for k := range idx {
			idx[k] = k
		}
		slices.SortFunc(idx, func(a, b int) int { return order[a] - order[b] })
		sorted := make([]call, len(calls))
		for k, j := range idx {
			sorted[k] = calls[j]
			served[calls[j].stop] = true
		}
		t.trips[i].calls = sorted
	}
	for id := range served {
		if s, ok := all[id]; ok {
			t.Stops = append(t.Stops, s)
		}
	}
	slices.SortFunc(t.Stops, func(a, b Stop) int { return strings.Compare(a.ID, b.ID) })

	if err := read("calendar.txt", false, func(get func(string) string) error {
		start, err1 := time.ParseInLocation("20060102", get("start_date"), Paris)
		end, err2 := time.ParseInLocation("20060102", get("end_date"), Paris)
		if err := errors.Join(err1, err2); err != nil {
			return err
		}
		week := [7]string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}
		for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
			if get(week[d.Weekday()]) == "1" {
				t.day(get("service_id"), d.Format("20060102"), true)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := read("calendar_dates.txt", false, func(get func(string) string) error {
		t.day(get("service_id"), get("date"), get("exception_type") == "1")
		return nil
	}); err != nil {
		return nil, err
	}
	if len(t.trips) == 0 {
		return nil, errors.New("gtfs: aucune ligne de tram ni de bus")
	}
	t.prepare()
	return t, nil
}

func (t *Timetable) day(service, date string, on bool) {
	if t.days[service] == nil {
		t.days[service] = map[string]bool{}
	}
	if on {
		t.days[service][date] = true
	} else {
		delete(t.days[service], date)
	}
}

// clock lit « 25:10:00 » (après minuit, le service de la veille continue).
func clock(s string) (int, error) {
	p := strings.Split(strings.TrimSpace(s), ":")
	if len(p) != 3 {
		return 0, fmt.Errorf("gtfs: heure %q", s)
	}
	var v [3]int
	for i := range p {
		n, err := strconv.Atoi(p[i])
		if err != nil {
			return 0, fmt.Errorf("gtfs: heure %q", s)
		}
		v[i] = n
	}
	return v[0]*3600 + v[1]*60 + v[2], nil
}
