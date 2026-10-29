package toll

// Fare : péage d'un itinéraire, pour une classe de véhicule.
type Fare struct {
	// Price : somme des tarifs connus (euros TTC).
	Price float64 `json:"price"`
	// Complete : chaque passage a un tarif dans la grille ; sinon Price est un minimum (0 : le
	// trajet est à péage mais rien n'a pu être chiffré).
	Complete bool `json:"complete"`
	// Gares : gares de la grille traversées, dans l'ordre.
	Gares []string `json:"gares"`
}

// Passage : un poste de péage franchi, dans l'ordre du trajet.
type Passage struct {
	// Gare : nom de la gare dans la grille ; vide pour un poste qu'on n'a pas su rattacher.
	Gare string
	// Break : le trajet a quitté l'autoroute depuis le poste précédent (nouveau ticket).
	Break bool
}

// Compute : péage des postes franchis. Un ticket va d'une gare à la suivante sur un même réseau,
// tant que le trajet reste sur l'autoroute ; on paie de la première gare du ticket à la dernière.
// Un péage à prix fixe se paie seul. Un poste inconnu, une gare seule ou une paire sans tarif
// rendent le total incomplet (un minimum). nil si aucun poste n'est franchi.
func Compute(c Class, passed []Passage) *Fare {
	if len(passed) == 0 {
		return nil
	}
	f := &Fare{Complete: true}
	var ticket []Gare // gares du ticket en cours, sans répétition
	close := func() {
		switch {
		case len(ticket) == 1:
			f.Complete = false // barrière seule : son tarif dépend d'une gare hors de la grille
		case len(ticket) > 1:
			net := Sanef[ticket[0].Net]
			if p, ok := net.Price(c, ticket[0].Index, ticket[len(ticket)-1].Index); ok {
				f.Price += p
			} else {
				f.Complete = false
			}
		}
		ticket = ticket[:0]
	}
	for _, p := range passed {
		g, ok := Lookup(p.Gare)
		if !ok {
			close()
			f.Complete = false
			continue
		}
		net := Sanef[g.Net]
		name := net.Gares[g.Index]
		if price, flat := net.Flat(c, name); flat {
			close()
			f.Price += price
			f.Gares = append(f.Gares, name)
			continue
		}
		if len(ticket) > 0 && (p.Break || ticket[0].Net != g.Net) {
			close()
		}
		if len(ticket) > 0 && ticket[len(ticket)-1] == g {
			continue // le même poste vu deux fois (deux voies, deux chaussées)
		}
		ticket = append(ticket, g)
		f.Gares = append(f.Gares, name)
	}
	close()
	return f
}
