package tarif

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Les grilles relevées à la main (tarifs.json) servent au démarrage et quand un site ne répond
// pas ; Refresh les remplace par celles que les exploitants publient le jour même.
var current atomic.Pointer[map[string]grid]

func grids() map[string]grid {
	if g := current.Load(); g != nil {
		return *g
	}
	return table.Parkings
}

// Refresh relit la grille de chaque parking sur le site de son exploitant. Une page illisible
// ou une grille invraisemblable garde la précédente : l'erreur est renvoyée, les autres
// parkings sont quand même mis à jour. changed liste les parkings dont le prix a changé.
func Refresh(ctx context.Context, client *http.Client) (updated int, changed []string, err error) {
	today := time.Now().In(paris).Format(time.DateOnly)
	prev := grids()
	next := make(map[string]grid, len(prev))
	var errs []error
	for id, old := range prev {
		next[id] = old
		g, e := fetchGrid(ctx, client, old)
		if e != nil {
			errs = append(errs, fmt.Errorf("%s (%s): %w", id, old.Name, e))
			continue
		}
		g.Name, g.Source, g.Checked = old.Name, old.Source, today
		if !samePrices(old, g) {
			changed = append(changed, id)
		}
		next[id] = g
		updated++
	}
	current.Store(&next)
	return updated, changed, errors.Join(errs...)
}

var paris = func() *time.Location {
	l, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		panic(err)
	}
	return l
}()

func fetchGrid(ctx context.Context, client *http.Client, g grid) (grid, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.Source, nil)
	if err != nil {
		return grid{}, err
	}
	req.Header.Set("User-Agent", "Zelo (+https://github.com/cytrafps/zelo)")
	res, err := client.Do(req)
	if err != nil {
		return grid{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return grid{}, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return grid{}, err
	}
	parse := parseCPA
	if len(g.Points) > 0 {
		parse = parseEffia
	}
	n, err := parse(string(body))
	if err != nil {
		return grid{}, err
	}
	return n, n.check()
}

// samePrices : mêmes montants pour chaque durée affichée.
func samePrices(a, b grid) bool {
	for _, m := range Durations {
		if a.price(m) != b.price(m) {
			return false
		}
	}
	return a.Free == b.Free
}

// check écarte une grille mal lue : au moins deux paliers, croissants, à des montants plausibles.
func (g grid) check() error {
	steps := g.Quarters
	if len(g.Points) > 0 {
		steps = g.Points
	}
	if len(steps) < 2 {
		return errors.New("grille incomplète")
	}
	for i, s := range steps {
		if s[1] <= 0 || s[1] > 5000 || (i > 0 && s[0] <= steps[i-1][0]) {
			return fmt.Errorf("palier invraisemblable %v", s)
		}
	}
	for _, m := range Durations {
		if g.price(m) < 0 {
			return fmt.Errorf("pas de prix pour %d min", m)
		}
	}
	return nil
}

var (
	cpaRow   = regexp.MustCompile(`(?s)<th>([^<]*)</th>\s*<td>([^<]*)</td>`)
	cpaCap   = regexp.MustCompile(`plafonné à ([\d,]+) €`)
	cpaRange = regexp.MustCompile(`à\s*(\d+)h(\d\d)`)
	minutes  = regexp.MustCompile(`^(\d+)\s*mn$`)
)

// parseCPA lit le tableau « Tarif par tranche de 15 minutes » de Champagne Parc Auto :
// « 30 mn | OFFERTES », « 30 mn à 2h00 | 0,60 € »…, « plafonné à 17,00 € ».
func parseCPA(page string) (grid, error) {
	start := strings.Index(page, `id="tarifshoraires"`)
	if start < 0 {
		return grid{}, errors.New("tableau des tarifs absent")
	}
	page = page[start:]
	if end := strings.Index(page, "</table>"); end >= 0 {
		page = page[:end]
	}
	var g grid
	for _, r := range cpaRow.FindAllStringSubmatch(page, -1) {
		label, value := clean(r[1]), clean(r[2])
		if strings.HasPrefix(strings.ToUpper(value), "OFFERT") {
			m := minutes.FindStringSubmatch(label)
			if m == nil {
				return grid{}, fmt.Errorf("durée offerte %q", label)
			}
			g.Free, _ = strconv.Atoi(m[1])
			continue
		}
		to := cpaRange.FindStringSubmatch(label)
		cents, err := euros(value)
		if to == nil || err != nil {
			return grid{}, fmt.Errorf("ligne %q | %q", label, value)
		}
		h, _ := strconv.Atoi(to[1])
		mn, _ := strconv.Atoi(to[2])
		g.Quarters = append(g.Quarters, [2]int{h*60 + mn, cents})
	}
	c := cpaCap.FindStringSubmatch(page)
	if c == nil {
		return grid{}, errors.New("plafond absent")
	}
	var err error
	g.Cap, err = euros(c[1])
	return g, err
}

var (
	effiaList = regexp.MustCompile(`(?s)<ul class="list row">(.*?)</ul>`)
	effiaRow  = regexp.MustCompile(`(?s)<span[^>]*>([^<]*)</span>\s*<span[^>]*>([^<]*)</span>`)
	effiaTime = regexp.MustCompile(`^(\d+)\s*(minutes?|hours?|heures?)$`)
)

// parseEffia lit la liste « Hourly rates » d'Effia : prix « jusqu'à » (« 1 hour | 1.80€ »).
// Les paliers gratuits donnent la durée offerte ; au-delà de 24 h, l'app n'affiche rien.
func parseEffia(page string) (grid, error) {
	start := strings.Index(page, "Hourly rates")
	if start < 0 {
		start = strings.Index(page, "Tarifs horaires")
	}
	if start < 0 {
		return grid{}, errors.New("tarifs horaires absents")
	}
	list := effiaList.FindStringSubmatch(page[start:])
	if list == nil {
		return grid{}, errors.New("liste des tarifs absente")
	}
	var g grid
	for _, r := range effiaRow.FindAllStringSubmatch(list[1], -1) {
		label, value := clean(r[1]), clean(r[2])
		t := effiaTime.FindStringSubmatch(label)
		cents, err := euros(value)
		if t == nil || err != nil {
			return grid{}, fmt.Errorf("ligne %q | %q", label, value)
		}
		m, _ := strconv.Atoi(t[1])
		if t[2][0] != 'm' {
			m *= 60
		}
		switch {
		case m > 1440:
		case cents == 0:
			g.Free = m
		default:
			g.Points = append(g.Points, [2]int{m, cents})
		}
	}
	return g, nil
}

func clean(s string) string { return strings.Join(strings.Fields(html.UnescapeString(s)), " ") }

// euros : « 0,60 € », « 1.80€ » ou « 17,00 » en centimes.
func euros(s string) (int, error) {
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "€"))
	whole, frac, _ := strings.Cut(strings.ReplaceAll(s, ",", "."), ".")
	e, err := strconv.Atoi(whole)
	if err != nil || len(frac) > 2 {
		return 0, fmt.Errorf("montant %q", s)
	}
	c := 0
	if frac != "" {
		frac += strings.Repeat("0", 2-len(frac))
		if c, err = strconv.Atoi(frac); err != nil {
			return 0, fmt.Errorf("montant %q", s)
		}
	}
	return e*100 + c, nil
}
