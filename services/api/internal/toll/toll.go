// Package toll : tarifs des péages en système fermé, par gare d'entrée et de sortie.
//
// Grille Sanef au 1er février 2026 (A1, A2, A4, A16, A26, A29), tirée du PDF officiel
// (www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage) par scripts/sanef-grid/extract.py.
// Une paire absente de la grille n'a pas de tarif : section gratuite (Verdun, Sarreguemines),
// trajet impossible, ou colonne que la grille ne permet pas d'attribuer sans deviner.
package toll

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
)

//go:embed sanef-2026.json
var sanef []byte

// Class : classe de péage (1 véhicule léger, 2 intermédiaire, 3 et 4 poids lourds, 5 moto).
type Class int

const (
	Car  Class = 1
	Moto Class = 5
)

// Network : un réseau de la grille (A4 – A26 Sud, A1 – A2 – A26 Nord – A29, A16 – A29).
type Network struct {
	Name  string
	Gares []string
	// prices[class][[2]int{i, j}] avec i < j : tarif TTC en euros.
	prices map[Class]map[[2]int]float64
	// flat[class][gare] : péage à prix fixe (bretelle sans ticket).
	flat map[Class]map[string]float64
}

// Price : tarif entre deux gares du réseau (indices dans Gares), dans un sens ou dans l'autre.
func (n *Network) Price(c Class, a, b int) (float64, bool) {
	if a > b {
		a, b = b, a
	}
	p, ok := n.prices[c][[2]int{a, b}]
	return p, ok
}

// Flat : tarif d'un péage à prix fixe.
func (n *Network) Flat(c Class, gare string) (float64, bool) {
	p, ok := n.flat[c][gare]
	return p, ok
}

// Sanef : les réseaux de la grille Sanef.
var Sanef = mustLoad(sanef)

func mustLoad(raw []byte) []*Network {
	var f struct {
		Classes map[string][]struct {
			Gares []string           `json:"gares"`
			Pairs [][3]float64       `json:"pairs"`
			Flat  map[string]float64 `json:"flat"`
		} `json:"classes"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		panic(fmt.Sprintf("toll: grille illisible : %v", err))
	}
	var nets []*Network
	for key, blocks := range f.Classes {
		var c Class
		if _, err := fmt.Sscan(key, &c); err != nil {
			panic("toll: classe " + key)
		}
		for i, b := range blocks {
			if len(nets) <= i {
				nets = append(nets, &Network{Gares: b.Gares, prices: map[Class]map[[2]int]float64{}, flat: map[Class]map[string]float64{}})
			}
			n := nets[i]
			n.prices[c] = make(map[[2]int]float64, len(b.Pairs))
			for _, p := range b.Pairs {
				a, z := int(p[0]), int(p[1])
				if a > z {
					a, z = z, a
				}
				n.prices[c][[2]int{a, z}] = p[2]
			}
			n.flat[c] = b.Flat
		}
	}
	for _, n := range nets {
		// Les péages à prix fixe sont des gares comme les autres pour le rattachement des postes.
		for g := range n.flat[Car] {
			n.Gares = append(n.Gares, g)
		}
		slices.Sort(n.Gares[len(n.Gares)-len(n.flat[Car]):])
		n.Name = n.Gares[0] + " – " + n.Gares[len(n.Gares)-1]
	}
	return nets
}
