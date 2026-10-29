package toll

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Gare : une gare de la grille, désignée par son réseau et son indice.
type Gare struct{ Net, Index int }

var (
	plazaRe = regexp.MustCompile(`(?i)\(p[ée]age d(?:e |')([^)]+)\)`)
	exitRe  = regexp.MustCompile(`N°\s*([0-9.]+)`)
	noise   = regexp.MustCompile(`\b(GARE|BARRIERE|PEAGE|DE|DU|D|LA|LE|LES|DES|SUR|EN|AUX?|ET|A\d+|N)\b`)
)

var unaccent = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// key : nom réduit à ses mots porteurs, sans accents ni casse (« Péage de Thillois » → « THILLOIS »).
func key(s string) string {
	s, _, _ = transform.String(unaccent, strings.ToUpper(s))
	s = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return ' '
	}, s)
	return strings.Join(strings.Fields(noise.ReplaceAllString(s, " ")), " ")
}

type gareKeys struct {
	Gare
	plaza, main, exit string
}

// byName : gare de la grille par son nom exact (les noms sont uniques, voir TestGareNamesUnique).
var byName = func() map[string]Gare {
	m := map[string]Gare{}
	for n, net := range Sanef {
		for i, g := range net.Gares {
			m[g] = Gare{n, i}
		}
	}
	return m
}()

// Lookup : la gare de ce nom dans la grille en vigueur.
func Lookup(name string) (Gare, bool) {
	g, ok := byName[name]
	return g, ok
}

// Name : nom de la gare dans la grille.
func (g Gare) Name() string { return Sanef[g.Net].Gares[g.Index] }

var index = func() (out []gareKeys) {
	for n, net := range Sanef {
		for i, g := range net.Gares {
			k := gareKeys{Gare: Gare{n, i}}
			if m := plazaRe.FindStringSubmatch(g); m != nil {
				k.plaza = key(m[1])
			}
			if m := exitRe.FindStringSubmatch(g); m != nil {
				k.exit = m[1]
			}
			k.main = key(plazaRe.ReplaceAllString(exitRe.ReplaceAllString(g, ""), ""))
			out = append(out, k)
		}
	}
	return out
}()

// Match : la gare de la grille que désigne un poste de péage. D'abord par son nom (« Péage de
// Thillois », « Reims Sud »), puis par la sortie toute proche : son numéro, départagé par son nom
// quand deux autoroutes ont le même. Rien de sûr : pas de gare.
func Match(b Booth) (Gare, bool) {
	// Une gare « REIMS (péage de Courcy) » ne se reconnaît qu'à « Courcy » : « Reims » seul
	// désigne aussi Reims Nord, Sud, Ouest, Est.
	accepts := func(k gareKeys, name string, prefix bool) bool {
		eq := func(a string) bool { return a != "" && (a == name || prefix && strings.HasPrefix(a+" ", name+" ")) }
		return eq(k.plaza) || k.plaza == "" && eq(k.main)
	}
	if name := key(b.Name); name != "" {
		var exact []Gare
		for _, k := range index {
			if accepts(k, name, false) {
				exact = append(exact, k.Gare)
			}
		}
		if len(exact) == 1 {
			return exact[0], true
		}
		if len(exact) > 1 {
			return Gare{}, false
		}
		// Début de nom (« Châlons-en-Champagne » pour « … / La Veuve ») : seulement si une seule
		// gare de toute la grille commence ainsi, nom de ville ou de péage.
		var starts []gareKeys
		for _, k := range index {
			if strings.HasPrefix(k.main+" ", name+" ") || k.plaza != "" && strings.HasPrefix(k.plaza+" ", name+" ") {
				starts = append(starts, k)
			}
		}
		if len(starts) == 1 && accepts(starts[0], name, true) {
			return starts[0].Gare, true
		}
		// Un poste nommé que la grille ne connaît pas n'est pas rattaché par la sortie voisine :
		// le nom dit justement que c'est autre chose.
		return Gare{}, false
	}
	if b.Exit == "" {
		return Gare{}, false
	}
	var found []gareKeys
	for _, k := range index {
		if k.exit == b.Exit {
			found = append(found, k)
		}
	}
	// Le numéro seul ne suffit jamais : le nom de la sortie doit aussi désigner la gare.
	words := strings.Fields(key(b.ExitName))
	var named []gareKeys
	for _, k := range found {
		for _, w := range words {
			if len(w) > 2 && strings.Contains(" "+k.main+" "+k.plaza+" ", " "+w+" ") {
				named = append(named, k)
				break
			}
		}
	}
	if len(named) == 1 {
		return named[0].Gare, true
	}
	return Gare{}, false
}
