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
	if name := key(b.Name); name != "" {
		var found []Gare
		for _, k := range index {
			if name == k.plaza || name == k.main {
				found = append(found, k.Gare)
			}
		}
		if len(found) == 1 {
			return found[0], true
		}
		// Nom plus court que celui de la grille (« Châlons-en-Champagne » pour « Châlons-en-Champagne
		// / La Veuve ») : ses mots forment le début du nom d'une seule gare.
		if len(found) == 0 {
			for _, k := range index {
				if strings.HasPrefix(k.main+" ", name+" ") || strings.HasPrefix(k.plaza+" ", name+" ") {
					found = append(found, k.Gare)
				}
			}
			if len(found) == 1 {
				return found[0], true
			}
		}
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
	if len(found) > 1 {
		words := strings.Fields(key(b.ExitName + " " + b.Name))
		var named []gareKeys
		for _, k := range found {
			for _, w := range words {
				if len(w) > 2 && strings.Contains(" "+k.main+" "+k.plaza+" ", " "+w+" ") {
					named = append(named, k)
					break
				}
			}
		}
		found = named
	}
	if len(found) == 1 {
		return found[0].Gare, true
	}
	return Gare{}, false
}
