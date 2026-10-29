// Package closure lit les fermetures de rues publiées par les collectivités dans DiaLog, la base
// nationale de la réglementation de circulation (DATEX II) : interdictions d'accès à tous les
// véhicules, permanentes, temporaires (travaux, événements) ou à heures fixes (rue piétonne le
// week-end). Le calcul d'itinéraire les contourne pendant qu'elles s'appliquent.
package closure

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // l'image de l'API n'a pas de base de fuseaux horaires
)

// FeedURL : toutes les réglementations publiées dans DiaLog (environ 80 Mo).
const FeedURL = "https://dialog.beta.gouv.fr/api/regulations/datex"

// BBox : zone retenue, en degrés.
type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

func (b BBox) has(p [2]float64) bool {
	return p[0] >= b.MinLon && p[0] <= b.MaxLon && p[1] >= b.MinLat && p[1] <= b.MaxLat
}

// Closure : une rue (ou un tronçon) interdite à tous les véhicules.
type Closure struct {
	ID    string
	Name  string // « Rue Buirette, de la place Drouet d'Erlon jusqu'à la rue Jeanne d'Arc »
	URL   string // l'arrêté sur DiaLog
	Lines [][][2]float64
	// From, To, Periods : vue d'ensemble pour l'affichage (début le plus tôt, fin la plus tardive,
	// zéro si l'une des validités n'a pas de début ou de fin). Sans Windows, ils décident aussi seuls.
	From time.Time // zéro : depuis toujours
	To   time.Time // zéro : sans fin
	// Periods : créneaux où la fermeture s'applique ; vide, elle s'applique en continu.
	Periods []Period
	// Windows : chaque validité de l'arrêté, avec ses propres dates et créneaux. Les fusionner
	// appliquerait les créneaux d'une validité pendant les dates d'une autre.
	Windows []Window
}

// Window : une validité de l'arrêté.
type Window struct {
	From, To time.Time // zéro : sans début, sans fin
	Periods  []Period  // vide : en continu
}

// Period : créneau récurrent, en heure de Paris, les jours donnés ou tous les jours. Un créneau
// qui finit avant de commencer passe minuit.
type Period struct {
	Days     []time.Weekday
	From, To int // minutes depuis minuit
	Zone     *time.Location
}

// Active : la fermeture s'applique-t-elle à l'instant t ?
func (c Closure) Active(t time.Time) bool {
	if len(c.Windows) == 0 {
		return Window{From: c.From, To: c.To, Periods: c.Periods}.active(t)
	}
	for _, w := range c.Windows {
		if w.active(t) {
			return true
		}
	}
	return false
}

func (w Window) active(t time.Time) bool {
	if (!w.From.IsZero() && t.Before(w.From)) || (!w.To.IsZero() && !t.Before(w.To)) {
		return false
	}
	if len(w.Periods) == 0 {
		return true
	}
	for _, p := range w.Periods {
		if p.active(t) {
			return true
		}
	}
	return false
}

func (p Period) active(t time.Time) bool {
	t = t.In(p.Zone)
	m := t.Hour()*60 + t.Minute()
	on := func(d time.Weekday) bool {
		if len(p.Days) == 0 {
			return true
		}
		for _, x := range p.Days {
			if x == d {
				return true
			}
		}
		return false
	}
	if p.From <= p.To {
		return on(t.Weekday()) && m >= p.From && m <= p.To
	}
	// Passe minuit : commencé ce jour-là, ou la veille.
	return (on(t.Weekday()) && m >= p.From) || (on((t.Weekday()+6)%7) && m <= p.To)
}

// Fetch télécharge DiaLog et garde les fermetures dont un tracé passe dans la zone.
func Fetch(ctx context.Context, client *http.Client, url string, zone BBox) ([]Closure, error) {
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
		return nil, fmt.Errorf("dialog: HTTP %d", res.StatusCode)
	}
	return Parse(io.LimitReader(res.Body, 512<<20), zone)
}

// Structure DATEX II publiée par DiaLog (seuls les champs utiles).
type order struct {
	ID          string       `xml:"id,attr"`
	Description string       `xml:"description>values>value"`
	Status      string       `xml:"status"`
	Regulations []regulation `xml:"trafficRegulation"`
	URL         string       `xml:"_trafficRegulationOrderExtension>trafficRegulationOrderExtended>publicUrl"`
}

type regulation struct {
	Status string `xml:"status"`
	Type   struct {
		Kind   string `xml:"http://www.w3.org/2001/XMLSchema-instance type,attr"`
		Access string `xml:"accessRestrictionType"`
	} `xml:"typeOfRegulation"`
	Condition condition `xml:"condition"`
}

type condition struct {
	Kind       string      `xml:"http://www.w3.org/2001/XMLSchema-instance type,attr"`
	Negate     bool        `xml:"negate"`
	Conditions []condition `xml:"conditions"`
	Validity   *validity   `xml:"validityByOrder>validityTimeSpecification"`
	Place      string      `xml:"locationByOrder>supplementaryPositionalDescription>locationDescription>values>value"`
	Road       string      `xml:"locationByOrder>supplementaryPositionalDescription>roadInformation>roadName"`
	Geometry   string      `xml:"locationByOrder>_linearLocationExtension>linearLocationExtended>geoJsonGeometry"`
}

type validity struct {
	Start   string `xml:"overallStartTime"`
	End     string `xml:"overallEndTime"`
	Periods []struct {
		From string   `xml:"recurringTimePeriodOfDay>startTimeOfPeriod"`
		To   string   `xml:"recurringTimePeriodOfDay>endTimeOfPeriod"`
		Days []string `xml:"recurringDayWeekMonthPeriod>applicableDay"`
	} `xml:"validPeriod"`
}

// Parse lit le flux DATEX II d'un bout à l'autre sans le garder en mémoire : seuls les arrêtés
// de la zone sont décodés.
func Parse(r io.Reader, zone BBox) ([]Closure, error) {
	dec := xml.NewDecoder(r)
	var out []Closure
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("dialog: %w", err)
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "trafficRegulationOrder" {
			continue
		}
		var o order
		if err := dec.DecodeElement(&o, &start); err != nil {
			return nil, fmt.Errorf("dialog: %w", err)
		}
		if o.Status != "madeAndImplemented" {
			continue
		}
		for i, reg := range o.Regulations {
			if c, ok := reg.closure(o, zone); ok {
				c.ID = o.ID + "/" + strconv.Itoa(i)
				out = append(out, c)
			}
		}
	}
}

// closure : la réglementation, si c'est une interdiction d'accès à tous les véhicules dans la zone.
func (reg regulation) closure(o order, zone BBox) (Closure, bool) {
	if reg.Status != "active" || reg.Type.Kind != "AccessRestriction" || reg.Type.Access != "noEntry" {
		return Closure{}, false
	}
	c := Closure{Name: o.Description, URL: o.URL}
	inZone, targeted := false, false
	var validities []*validity
	var walk func(x condition, negated bool)
	walk = func(x condition, negated bool) {
		switch x.Kind {
		case "VehicleCondition":
			// Les véhicules visés (poids lourds, hauteur…) font une restriction, pas une fermeture ;
			// les exemptions (livraisons, riverains) ne changent rien pour un conducteur de passage.
			if !x.Negate && !negated {
				targeted = true
			}
		case "ValidityCondition":
			if x.Validity != nil {
				validities = append(validities, x.Validity)
			}
		case "LocationCondition":
			if name := strings.TrimSpace(x.Place + " " + x.Road); name != "" {
				c.Name = name
			}
			for _, l := range lines(x.Geometry) {
				c.Lines = append(c.Lines, l)
				for _, p := range l {
					inZone = inZone || zone.has(p)
				}
			}
		}
		for _, sub := range x.Conditions {
			walk(sub, negated || x.Negate)
		}
	}
	walk(reg.Condition, false)
	if targeted || !inZone {
		return Closure{}, false
	}
	for i, v := range validities {
		from, err1 := parseTime(v.Start)
		to, err2 := parseTime(v.End)
		if errors.Join(err1, err2) != nil {
			return Closure{}, false // date illisible : mieux vaut ne pas fermer la rue que la fermer à tort
		}
		w := Window{From: from, To: to}
		for _, p := range v.Periods {
			q, ok := period(p.From, p.To, p.Days, from)
			if !ok {
				// Créneau illisible : sans lui, la fermeture s'appliquerait en continu.
				return Closure{}, false
			}
			w.Periods = append(w.Periods, q)
		}
		c.Windows = append(c.Windows, w)
		c.Periods = append(c.Periods, w.Periods...)
		if i == 0 || (!c.From.IsZero() && (from.IsZero() || from.Before(c.From))) {
			c.From = from
		}
		if i == 0 || (!c.To.IsZero() && (to.IsZero() || to.After(c.To))) {
			c.To = to
		}
	}
	return c, true
}

// parseTime : heure RFC 3339, ou zéro si absente.
func parseTime(s string) (time.Time, error) {
	if s = strings.TrimSpace(s); s == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, s)
}

var weekdays = map[string]time.Weekday{
	"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday, "wednesday": time.Wednesday,
	"thursday": time.Thursday, "friday": time.Friday, "saturday": time.Saturday,
}

// Paris : les arrêtés de la zone sont pris en heure de Paris.
var Paris = func() *time.Location {
	l, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		panic(err) // time/tzdata est embarqué : n'arrive pas
	}
	return l
}()

// period lit « 23:00:00+00:00 » → « 06:00:00+00:00 » et les jours anglais de DATEX.
//
// DiaLog saisit des heures de Paris et les publie converties en UTC avec le décalage du moment de
// la saisie, mais garde le jour saisi : « lundi 00:00–07:00 » devient « monday 23:00Z–06:00Z ».
// Lues telles quelles, elles fermaient la rue le mardi de 0 h à 7 h, et une heure plus tard en été.
// On retrouve l'heure saisie avec le décalage de Paris au début de la validité (`ref`), puis le
// créneau s'applique en heure de Paris, le jour indiqué.
func period(from, to string, days []string, ref time.Time) (Period, bool) {
	f, err1 := time.Parse("15:04:05Z07:00", strings.TrimSpace(from))
	t, err2 := time.Parse("15:04:05Z07:00", strings.TrimSpace(to))
	if errors.Join(err1, err2) != nil {
		return Period{}, false
	}
	if ref.IsZero() {
		ref = time.Now()
	}
	_, paris := ref.In(Paris).Zone()
	wall := func(v time.Time) int {
		_, own := v.Zone()
		m := v.Hour()*60 + v.Minute() + (paris-own)/60
		return ((m % 1440) + 1440) % 1440
	}
	p := Period{From: wall(f), To: wall(t), Zone: Paris}
	for _, d := range days {
		w, ok := weekdays[strings.TrimSpace(d)]
		if !ok {
			return Period{}, false
		}
		p.Days = append(p.Days, w)
	}
	return p, true
}

// lines : tracés d'une géométrie GeoJSON (LineString ou MultiLineString).
func lines(raw string) [][][2]float64 {
	var g struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	}
	if json.Unmarshal([]byte(raw), &g) != nil {
		return nil
	}
	switch g.Type {
	case "LineString":
		var l [][2]float64
		if json.Unmarshal(g.Coordinates, &l) == nil && len(l) > 1 {
			return [][][2]float64{l}
		}
	case "MultiLineString":
		var ls [][][2]float64
		if json.Unmarshal(g.Coordinates, &ls) == nil {
			out := ls[:0]
			for _, l := range ls {
				if len(l) > 1 {
					out = append(out, l)
				}
			}
			return out
		}
	}
	return nil
}
