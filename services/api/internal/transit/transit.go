// Package transit lit les horaires théoriques du tram (GTFS du réseau Citura) et répond à la
// question du parking relais : depuis cet arrêt, quand part le prochain tram pour cet autre arrêt,
// et à quelle heure arrive-t-il ?
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
	ID       string
	Name     string
	Lat, Lon float64
}

type call struct {
	stop string // station mère
	dep  int    // secondes depuis minuit du jour de service (peut dépasser 24 h)
	arr  int
}

type trip struct {
	service  string
	line     string
	headsign string
	calls    []call
}

// Line : une ligne de tram et sa couleur.
type Line struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`     // hexadécimal sans « # »
	TextColor string `json:"textColor"` // idem
}

// Timetable : le tram seulement (route_type 0, ou 1 tel que Citura déclare son tram).
type Timetable struct {
	Stops []Stop
	Lines map[string]Line
	trips []trip
	// days[service] : jours de service (AAAAMMJJ) où il circule.
	days map[string]map[string]bool
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
		if typ := get("route_type"); typ == "0" || typ == "1" {
			id := get("route_id")
			t.Lines[id] = Line{ID: id, Name: get("route_short_name"), Color: get("route_color"), TextColor: get("route_text_color")}
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
			t.trips = append(t.trips, trip{service: get("service_id"), line: get("route_id"), headsign: get("trip_headsign")})
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
		t.trips[i].calls = append(t.trips[i].calls, call{stop: station(get("stop_id")), dep: dep, arr: arr})
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
		return nil, errors.New("gtfs: aucune ligne de tram")
	}
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

// Ride : un tram entre deux arrêts.
type Ride struct {
	LineID   string    `json:"-"`
	Line     string    `json:"line"`
	Headsign string    `json:"headsign"`
	Depart   time.Time `json:"depart"`
	Arrive   time.Time `json:"arrive"`
	Stops    int       `json:"stops"` // arrêts parcourus
}

// Rides : les trams de from à to qui partent entre after et after+within, dans l'ordre.
func (t *Timetable) Rides(from, to string, after time.Time, within time.Duration) []Ride {
	var out []Ride
	after = after.In(Paris)
	// Jours de service à regarder : la veille (trajets après minuit) et le jour même, plus le
	// lendemain si la fenêtre déborde.
	for d := -1; d <= 1; d++ {
		day := time.Date(after.Year(), after.Month(), after.Day()+d, 12, 0, 0, 0, Paris).Add(-12 * time.Hour)
		key := day.Format("20060102")
		for _, tr := range t.trips {
			if !t.days[tr.service][key] {
				continue
			}
			i := slices.IndexFunc(tr.calls, func(c call) bool { return c.stop == from })
			if i < 0 {
				continue
			}
			j := slices.IndexFunc(tr.calls[i+1:], func(c call) bool { return c.stop == to })
			if j < 0 {
				continue
			}
			j += i + 1
			dep := day.Add(time.Duration(tr.calls[i].dep) * time.Second)
			if dep.Before(after) || dep.After(after.Add(within)) {
				continue
			}
			out = append(out, Ride{
				LineID: tr.line, Line: t.Lines[tr.line].Name, Headsign: tr.headsign, Depart: dep,
				Arrive: day.Add(time.Duration(tr.calls[j].arr) * time.Second), Stops: j - i,
			})
		}
	}
	slices.SortFunc(out, func(a, b Ride) int { return a.Depart.Compare(b.Depart) })
	return out
}
