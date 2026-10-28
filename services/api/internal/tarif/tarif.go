// Package tarif donne le prix des principaux parkings payants de Reims.
//
// Aucune source ouverte ne publie ces tarifs : ils sont relevés à la main sur le site de
// chaque exploitant (lien dans tarifs.json) et datés. Seul le tarif affiché sur place fait foi.
package tarif

import (
	_ "embed"
	"encoding/json"
)

// Durées affichées (min) : publiées par tous les exploitants, donc jamais interpolées.
var Durations = []int{60, 180, 1440}

// Price : prix (centimes) d'un stationnement de Minutes minutes.
type Price struct {
	Minutes int `json:"minutes"`
	Cents   int `json:"cents"`
}

// Summary : ce que l'app affiche d'un parking.
type Summary struct {
	Free    int     `json:"free"` // minutes offertes
	Prices  []Price `json:"prices"`
	Source  string  `json:"source"`
	Checked string  `json:"checked"` // date du relevé, AAAA-MM-JJ
}

// Grille d'un exploitant, sous l'une des deux formes publiées :
//   - Quarters : prix par quart d'heure commencé, par tranche [jusqu'à la minute, centimes],
//     plafonné à Cap au-delà de la dernière tranche et jusqu'à 24 h (Champagne Parc Auto) ;
//   - Points : prix « jusqu'à » [minutes, centimes] (Effia).
type grid struct {
	Name     string   `json:"name"`
	Source   string   `json:"source"`
	Free     int      `json:"free"`
	Quarters [][2]int `json:"quarters"`
	Cap      int      `json:"cap"`
	Points   [][2]int `json:"points"`
}

// price : centimes pour m minutes (m ≤ 24 h), ou -1 si la grille ne le dit pas.
func (g grid) price(m int) int {
	if m <= g.Free {
		return 0
	}
	if len(g.Points) > 0 {
		for _, p := range g.Points {
			if m <= p[0] {
				return p[1]
			}
		}
		return -1
	}
	if len(g.Quarters) == 0 {
		return -1
	}
	cents, from := 0, g.Free
	for _, q := range g.Quarters {
		if m <= from {
			break
		}
		upTo := min(m, q[0])
		cents += (upTo - from + 14) / 15 * q[1] // quart d'heure commencé, dû
		from = q[0]
	}
	if m > g.Quarters[len(g.Quarters)-1][0] {
		return g.Cap
	}
	if g.Cap > 0 {
		cents = min(cents, g.Cap)
	}
	return cents
}

//go:embed tarifs.json
var raw []byte

var table = func() (t struct {
	Checked  string          `json:"checked"`
	Parkings map[string]grid `json:"parkings"`
}) {
	if err := json.Unmarshal(raw, &t); err != nil {
		panic("tarifs.json : " + err.Error())
	}
	return t
}()

// For renvoie les tarifs du parking OSM `id` (« way/123 »), ou nil s'il n'a pas été relevé.
func For(id string) *Summary {
	g, ok := table.Parkings[id]
	if !ok {
		return nil
	}
	s := &Summary{Free: g.Free, Source: g.Source, Checked: table.Checked}
	for _, m := range Durations {
		if c := g.price(m); c >= 0 {
			s.Prices = append(s.Prices, Price{m, c})
		}
	}
	return s
}
