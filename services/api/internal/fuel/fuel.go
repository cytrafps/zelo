// Package fuel lit le flux instantané des prix des carburants
// (prix-carburants.gouv.fr, Licence Ouverte 2.0).
package fuel

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// FeedURL est le flux officiel, régénéré environ toutes les 10 minutes.
const FeedURL = "https://donnees.roulez-eco.fr/opendata/instantane"

type Station struct {
	ID       string
	Lat, Lon float64
	Postcode string
	Address  string
	City     string
	Prices   []Price
}

type Price struct {
	Fuel      string // Gazole, SP95, SP98, E10, E85, GPLc
	Value     float64
	UpdatedAt time.Time
}

var paris = mustLoad("Europe/Paris")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Fetch télécharge le ZIP et renvoie les stations qui ont des coordonnées valides.
func Fetch(ctx context.Context, client *http.Client, url string) ([]Station, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fuel: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, fmt.Errorf("fuel: zip: %w", err)
	}
	if len(zr.File) == 0 {
		return nil, fmt.Errorf("fuel: zip vide")
	}
	f, err := zr.File[0].Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f)
}

type xmlPDV struct {
	ID      string `xml:"id,attr"`
	Lat     string `xml:"latitude,attr"`
	Lon     string `xml:"longitude,attr"`
	CP      string `xml:"cp,attr"`
	Adresse string `xml:"adresse"`
	Ville   string `xml:"ville"`
	Prix    []struct {
		Nom    string `xml:"nom,attr"`
		Valeur string `xml:"valeur,attr"`
		Maj    string `xml:"maj,attr"`
	} `xml:"prix"`
}

// Parse lit le XML (ISO-8859-1) en flux, sans tout charger en mémoire.
func Parse(r io.Reader) ([]Station, error) {
	dec := xml.NewDecoder(r)
	dec.CharsetReader = charset.NewReaderLabel
	stations := make([]Station, 0, 10000)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return stations, nil
		}
		if err != nil {
			return nil, fmt.Errorf("fuel: xml: %w", err)
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "pdv" {
			continue
		}
		var p xmlPDV
		if err := dec.DecodeElement(&p, &se); err != nil {
			return nil, fmt.Errorf("fuel: pdv: %w", err)
		}
		lat, okLat := coord(p.Lat, 90)
		lon, okLon := coord(p.Lon, 180)
		if !okLat || !okLon || p.ID == "" {
			continue
		}
		s := Station{
			ID: p.ID, Lat: lat, Lon: lon, Postcode: p.CP,
			Address: strings.TrimSpace(p.Adresse), City: strings.TrimSpace(p.Ville),
		}
		for _, x := range p.Prix {
			v, err := strconv.ParseFloat(x.Valeur, 64)
			if err != nil || v <= 0 || x.Nom == "" {
				continue
			}
			if v > 100 { // anciens flux en millièmes d'euro
				v /= 1000
			}
			t, err := parseMaj(x.Maj)
			if err != nil {
				continue
			}
			s.Prices = append(s.Prices, Price{Fuel: x.Nom, Value: v, UpdatedAt: t})
		}
		stations = append(stations, s)
	}
}

// coord accepte les degrés ×100 000 (format du flux) ou des degrés décimaux.
func coord(s string, max float64) (float64, bool) {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || v == 0 {
		return 0, false
	}
	if math.Abs(v) > max {
		v /= 100000
	}
	return v, math.Abs(v) <= max
}

func parseMaj(s string) (time.Time, error) {
	s = strings.Replace(strings.TrimSpace(s), "T", " ", 1)
	return time.ParseInLocation("2006-01-02 15:04:05", s, paris)
}
