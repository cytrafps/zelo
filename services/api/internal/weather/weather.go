// Package weather lit la prévision au quart d'heure d'Open-Meteo (modèles Météo-France AROME et
// ARPEGE) : pluie et température à l'heure d'arrivée, pour proposer un parking couvert.
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// BaseURL : API gratuite d'Open-Meteo (usage non commercial, 10 000 appels par jour).
const BaseURL = "https://api.open-meteo.com/v1/forecast"

// Slot : un quart d'heure de prévision.
type Slot struct {
	At     time.Time
	RainMM float64 // précipitations sur le quart d'heure
	TempC  float64
}

// Fetch : prévision des 12 prochaines heures au point.
func Fetch(ctx context.Context, client *http.Client, base string, lat, lon float64) ([]Slot, error) {
	q := url.Values{
		"latitude":             {strconv.FormatFloat(lat, 'f', 4, 64)},
		"longitude":            {strconv.FormatFloat(lon, 'f', 4, 64)},
		"minutely_15":          {"precipitation,temperature_2m"},
		"forecast_minutely_15": {"48"},
		"timezone":             {"GMT"},
		"models":               {"meteofrance_seamless"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open-meteo: HTTP %d", res.StatusCode)
	}
	return Parse(io.LimitReader(res.Body, 1<<20))
}

// Parse lit la réponse d'Open-Meteo (heures en GMT).
func Parse(r io.Reader) ([]Slot, error) {
	var body struct {
		M struct {
			Time []string   `json:"time"`
			Rain []*float64 `json:"precipitation"`
			Temp []*float64 `json:"temperature_2m"`
		} `json:"minutely_15"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return nil, fmt.Errorf("open-meteo: %w", err)
	}
	m := body.M
	if len(m.Rain) != len(m.Time) || len(m.Temp) != len(m.Time) {
		return nil, fmt.Errorf("open-meteo: séries de longueurs différentes")
	}
	out := make([]Slot, 0, len(m.Time))
	for i, s := range m.Time {
		at, err := time.Parse("2006-01-02T15:04", s)
		if err != nil || m.Rain[i] == nil || m.Temp[i] == nil {
			continue // créneau sans valeur : ignoré
		}
		out = append(out, Slot{At: at, RainMM: *m.Rain[i], TempC: *m.Temp[i]})
	}
	return out, nil
}

// Seuils : au-delà de 0,2 mm en un quart d'heure, on se mouille ; à 1 °C ou moins, gel possible.
const (
	RainMM = 0.2
	ColdC  = 1.0
)

// Outlook : le temps autour d'une heure d'arrivée (une demi-heure de part et d'autre).
type Outlook struct {
	Rain  bool    `json:"rain"`
	Cold  bool    `json:"cold"`
	TempC float64 `json:"temperature"`
	// RainMM : le plus fort quart d'heure de la fenêtre.
	RainMM float64 `json:"rainMm"`
}

// At : le temps à l'arrivée ; ok faux si la prévision ne couvre pas cette heure.
func At(slots []Slot, arrive time.Time) (o Outlook, ok bool) {
	from, to := arrive.Add(-30*time.Minute), arrive.Add(30*time.Minute)
	minT := math.Inf(1)
	for _, s := range slots {
		if s.At.Before(from) || s.At.After(to) {
			continue
		}
		ok = true
		o.RainMM = max(o.RainMM, s.RainMM)
		minT = min(minT, s.TempC)
	}
	if !ok {
		return Outlook{}, false
	}
	o.TempC, o.Rain, o.Cold = minT, o.RainMM >= RainMM, minT <= ColdC
	return o, true
}

// Cache : une prévision par maille de 0,05° (environ 4 km), gardée 15 min. Open-Meteo est appelé
// une fois par maille, quel que soit le nombre de conducteurs.
type Cache struct {
	Fetch func(ctx context.Context, lat, lon float64) ([]Slot, error)
	TTL   time.Duration

	mu    sync.Mutex
	cells map[[2]int]cell
}

type cell struct {
	at    time.Time
	slots []Slot
}

const mesh = 0.05

// Get : la prévision de la maille du point.
func (c *Cache) Get(ctx context.Context, lat, lon float64) ([]Slot, error) {
	k := [2]int{int(math.Floor(lat / mesh)), int(math.Floor(lon / mesh))}
	c.mu.Lock()
	if e, ok := c.cells[k]; ok && time.Since(e.at) < c.TTL {
		c.mu.Unlock()
		return e.slots, nil
	}
	c.mu.Unlock()
	// Centre de la maille : tous les points de la maille partagent la même prévision.
	slots, err := c.Fetch(ctx, (float64(k[0])+0.5)*mesh, (float64(k[1])+0.5)*mesh)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.cells == nil {
		c.cells = map[[2]int]cell{}
	}
	for key, e := range c.cells { // les mailles périmées ne s'accumulent pas
		if time.Since(e.at) >= c.TTL {
			delete(c.cells, key)
		}
	}
	c.cells[k] = cell{time.Now(), slots}
	c.mu.Unlock()
	return slots, nil
}
