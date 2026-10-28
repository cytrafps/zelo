// Package vigilance lit la carte de vigilance de Météo-France (API DonneesPubliquesVigilance,
// clé gratuite sur portail-api.meteofrance.fr) : niveau de danger par département et par
// phénomène, pour aujourd'hui et demain.
package vigilance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// URL : carte en cours ; Météo-France la met à jour au moins deux fois par jour (6 h et 16 h).
const URL = "https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours"

// Phénomènes (identifiants Météo-France).
var Phenomena = map[string]string{
	"1": "vent violent", "2": "pluie-inondation", "3": "orages", "4": "crues", "5": "neige-verglas",
	"6": "canicule", "7": "grand froid", "8": "avalanches", "9": "vagues-submersion",
}

// Colors : 1 vert, 2 jaune, 3 orange, 4 rouge.
var Colors = map[int]string{1: "verte", 2: "jaune", 3: "orange", 4: "rouge"}

// Span : un niveau sur un créneau, pour un phénomène.
type Span struct {
	Phenomenon string
	Color      int
	From, To   time.Time
}

// Map : la carte, par département (« 51 »).
type Map struct {
	Updated time.Time
	Spans   map[string][]Span
}

// Fetch télécharge la carte en cours.
func Fetch(ctx context.Context, client *http.Client, url, key string) (*Map, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", key)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("vigilance: HTTP %d", res.StatusCode)
	}
	return Parse(io.LimitReader(res.Body, 16<<20))
}

// Parse lit la carte (format cdp_carte_externe, vigilance V6).
func Parse(r io.Reader) (*Map, error) {
	var body struct {
		Product struct {
			Updated time.Time `json:"update_time"`
			Periods []struct {
				Timelaps struct {
					Domains []struct {
						ID         string `json:"domain_id"`
						Phenomenon []struct {
							ID    string `json:"phenomenon_id"`
							Items []struct {
								From  time.Time `json:"begin_time"`
								To    time.Time `json:"end_time"`
								Color int       `json:"color_id"`
							} `json:"timelaps_items"`
						} `json:"phenomenon_items"`
					} `json:"domain_ids"`
				} `json:"timelaps"`
			} `json:"periods"`
		} `json:"product"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return nil, fmt.Errorf("vigilance: %w", err)
	}
	m := &Map{Updated: body.Product.Updated, Spans: map[string][]Span{}}
	for _, p := range body.Product.Periods {
		for _, d := range p.Timelaps.Domains {
			for _, ph := range d.Phenomenon {
				for _, it := range ph.Items {
					m.Spans[d.ID] = append(m.Spans[d.ID], Span{ph.ID, it.Color, it.From, it.To})
				}
			}
		}
	}
	if len(m.Spans) == 0 {
		return nil, fmt.Errorf("vigilance: carte vide")
	}
	return m, nil
}

// Alert : la vigilance la plus haute à cet instant dans le département, à partir du jaune.
type Alert struct {
	Color      string   `json:"color"` // « jaune », « orange », « rouge »
	Level      int      `json:"level"` // 2 à 4
	Phenomena  []string `json:"phenomena"`
	Department string   `json:"department"`
}

// At : l'alerte en cours à t dans le département, ou nil (vigilance verte ou carte muette).
func (m *Map) At(department string, t time.Time) *Alert {
	if m == nil {
		return nil
	}
	level, seen := 1, map[string]bool{}
	var phenomena []string
	for _, s := range m.Spans[department] {
		if t.Before(s.From) || !t.Before(s.To) || s.Color < 2 {
			continue
		}
		if s.Color > level {
			level, phenomena, seen = s.Color, nil, map[string]bool{}
		}
		if s.Color == level && !seen[s.Phenomenon] {
			seen[s.Phenomenon] = true
			phenomena = append(phenomena, Phenomena[s.Phenomenon])
		}
	}
	if level < 2 {
		return nil
	}
	return &Alert{Color: Colors[level], Level: level, Phenomena: phenomena, Department: department}
}
