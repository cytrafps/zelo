package toll

// Fare : péage d'un itinéraire, pour une classe de véhicule.
type Fare struct {
	// Price : somme des tarifs connus (euros TTC).
	Price float64 `json:"price"`
	// Complete : chaque passage a un tarif dans la grille ; sinon Price est un minimum.
	Complete bool `json:"complete"`
	// Gares : gares de la grille traversées, dans l'ordre.
	Gares []string `json:"gares"`
}

// Compute : péage de la suite de gares traversées, dans l'ordre de passage. Sur un même réseau
// (système fermé), on paie de la première gare à la dernière ; un passage seul est un péage à
// prix fixe, ou une barrière dont le tarif dépend d'une gare hors de la grille (incomplet).
// nil si l'itinéraire ne passe aucun péage.
func Compute(c Class, passed []Gare) *Fare {
	var seq []Gare
	for _, g := range passed {
		if len(seq) == 0 || seq[len(seq)-1] != g {
			seq = append(seq, g)
		}
	}
	if len(seq) == 0 {
		return nil
	}
	f := &Fare{Complete: true}
	for i := 0; i < len(seq); {
		j := i
		for j+1 < len(seq) && seq[j+1].Net == seq[i].Net {
			j++
		}
		net := Sanef[seq[i].Net]
		for k := i; k <= j; k++ {
			f.Gares = append(f.Gares, net.Gares[seq[k].Index])
		}
		if i == j {
			if p, ok := net.Flat(c, net.Gares[seq[i].Index]); ok {
				f.Price += p
			} else {
				f.Complete = false
			}
		} else if p, ok := net.Price(c, seq[i].Index, seq[j].Index); ok {
			f.Price += p
		} else {
			f.Complete = false
		}
		i = j + 1
	}
	return f
}
