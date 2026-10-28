package tarif

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
)

// Les pages des exploitants relevées le 28 octobre 2026 donnent les grilles de tarifs.json.
func TestParsePages(t *testing.T) {
	cases := []struct {
		file, id string
		parse    func(string) (grid, error)
	}{
		{"cpa-erlon.html", "way/31432939", parseCPA},
		{"cpa-republique.html", "way/720964467", parseCPA},
		{"effia-gare.html", "way/87834494", parseEffia},
	}
	for _, c := range cases {
		page, err := os.ReadFile("testdata/" + c.file)
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.parse(string(page))
		if err != nil {
			t.Fatalf("%s : %v", c.file, err)
		}
		want := table.Parkings[c.id]
		if got.Free != want.Free || got.Cap != want.Cap || !slices.Equal(got.Quarters, want.Quarters) || !slices.Equal(got.Points, want.Points) {
			t.Errorf("%s : %+v, attendu %+v", c.file, got, want)
		}
		if err := got.check(); err != nil {
			t.Errorf("%s : %v", c.file, err)
		}
	}
}

func TestEuros(t *testing.T) {
	for in, want := range map[string]int{"0,60 €": 60, "1.80€": 180, "17,00": 1700, "4,5 €": 450, "27 €": 2700} {
		if got, err := euros(in); err != nil || got != want {
			t.Errorf("%q : %d, %v", in, got, err)
		}
	}
	if _, err := euros("gratuit"); err == nil {
		t.Error("montant illisible accepté")
	}
}

// Une page refondue garde la grille précédente ; une grille modifiée est signalée et servie.
func TestRefresh(t *testing.T) {
	t.Cleanup(func() { current.Store(nil) })
	erlon, _ := os.ReadFile("testdata/cpa-erlon.html")
	effia, _ := os.ReadFile("testdata/effia-gare.html")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "effia"):
			w.Write([]byte(strings.Replace(string(effia), "1.80€", "2.00€", 1))) // 1 h passe à 2 €
		case strings.Contains(r.URL.Path, "erlon"):
			w.Write(erlon)
		default:
			w.Write([]byte("<html>Nouveau site</html>"))
		}
	}))
	defer srv.Close()
	local := map[string]grid{}
	for id, g := range table.Parkings {
		g.Source = srv.URL + "/" + strings.ToLower(strings.Fields(g.Name)[0]) + map[bool]string{true: "-effia"}[len(g.Points) > 0]
		local[id] = g
	}
	current.Store(&local)

	n, changed, err := Refresh(context.Background(), srv.Client())
	if n != 2 || err == nil || !slices.Equal(changed, []string{"way/87834494"}) {
		t.Fatalf("%d à jour, changés %v, erreur %v", n, changed, err)
	}
	if s := For("way/87834494"); s.Prices[0] != (Price{60, 200}) || grids()["way/87834494"].Checked == "" {
		t.Errorf("Effia : %+v", s)
	}
	if s := For("way/720964467"); grids()["way/720964467"].Checked != "" || s.Prices[0] != (Price{60, 120}) {
		t.Errorf("République, page illisible : grille précédente attendue, %+v", s)
	}
}
