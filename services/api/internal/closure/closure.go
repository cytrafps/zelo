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
	From  time.Time // zéro : depuis toujours
	To    time.Time // zéro : sans fin
	// Periods : créneaux où la fermeture s'applique ; vide, elle s'applique en continu.
	Periods []Period
}

// Period : créneau récurrent (heures dans le fuseau `Zone` publié, souvent UTC), les jours
// donnés ou tous les jours. Un créneau qui finit avant de commencer passe minuit.
type Period struct {
	Days     []time.Weekday
	From, To int // minutes depuis minuit
	Zone     *time.Location
}

// Active : la fermeture s'applique-t-elle à l'instant t ?
func (c Closure) Active(t time.Time) bool {
	if (!c.From.IsZero() && t.Before(c.From)) || (!c.To.IsZero() && !t.Before(c.To)) {
		return false
	}
	if len(c.Periods) == 0 {
		return true
	}
	for _, p := range c.Periods {
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
	for _, v := range validities {
		from, _ := time.Parse(time.RFC3339, v.Start)
		to, _ := time.Parse(time.RFC3339, v.End)
		if c.From.IsZero() || (!from.IsZero() && from.Before(c.From)) {
			c.From = from
		}
		if !to.IsZero() && to.After(c.To) {
			c.To = to
		}
		for _, p := range v.Periods {
			if q, ok := period(p.From, p.To, p.Days); ok {
				c.Periods = append(c.Periods, q)
			}
		}
	}
	return c, true
}

var weekdays = map[string]time.Weekday{
	"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday, "wednesday": time.Wednesday,
	"thursday": time.Thursday, "friday": time.Friday, "saturday": time.Saturday,
}

// period lit « 23:00:00+00:00 » → « 06:00:00+00:00 » et les jours anglais de DATEX.
func period(from, to string, days []string) (Period, bool) {
	f, err1 := time.Parse("15:04:05Z07:00", strings.TrimSpace(from))
	t, err2 := time.Parse("15:04:05Z07:00", strings.TrimSpace(to))
	if errors.Join(err1, err2) != nil {
		return Period{}, false
	}
	p := Period{From: f.Hour()*60 + f.Minute(), To: t.Hour()*60 + t.Minute(), Zone: f.Location()}
	for _, d := range days {
		if w, ok := weekdays[strings.TrimSpace(d)]; ok {
			p.Days = append(p.Days, w)
		}
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
