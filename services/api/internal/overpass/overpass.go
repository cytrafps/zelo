// Package overpass interroge l'API Overpass d'OpenStreetMap (données © contributeurs
// OpenStreetMap, licence ODbL), source des parkings et des feux et stops.
package overpass

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// URL est l'instance publique ; à remplacer par une instance dédiée en production.
const URL = "https://overpass-api.de/api/interpreter"

// userAgent identifie le projet, comme le demande la politique d'usage d'Overpass.
const userAgent = "zelo/0.1 (+https://github.com/cytrafps/zelo)"

type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

// Filter : la zone au format Overpass QL, « (sud,ouest,nord,est) ».
func (b BBox) Filter() string {
	return fmt.Sprintf("(%g,%g,%g,%g)", b.MinLat, b.MinLon, b.MaxLat, b.MaxLon)
}

type Element struct {
	Type   string                      `json:"type"`
	ID     int64                       `json:"id"`
	Lat    float64                     `json:"lat"`
	Lon    float64                     `json:"lon"`
	Center *struct{ Lat, Lon float64 } `json:"center"`
	Tags   map[string]string           `json:"tags"`
	// Geometry : sommets d'un chemin (« out geom »).
	Geometry []struct{ Lat, Lon float64 } `json:"geometry"`
}

// slot : une requête à la fois par processus. L'instance publique n'accorde que deux créneaux par
// adresse IP et répond 429 ou 502 au-delà ; les imports (parkings, feux, aires) partent ensemble
// au démarrage.
var slot = make(chan struct{}, 1)

// backoff : attentes entre les essais quand Overpass est saturé (429, 502, 503, 504) ou injoignable.
var backoff = []time.Duration{30 * time.Second, 2 * time.Minute, 5 * time.Minute}

// Fetch envoie la requête Overpass QL et renvoie ses éléments. Une saturation passagère est
// retentée plus tard (dans la limite du contexte) ; une autre erreur est renvoyée tout de suite.
func Fetch(ctx context.Context, client *http.Client, endpoint, query string) ([]Element, error) {
	for attempt := 0; ; attempt++ {
		els, retry, err := fetchOnce(ctx, client, endpoint, query)
		if err == nil || !retry || attempt == len(backoff) {
			return els, err
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("%w (abandon : %v)", err, ctx.Err())
		case <-time.After(backoff[attempt]):
		}
	}
}

func fetchOnce(ctx context.Context, client *http.Client, endpoint, query string) (els []Element, retry bool, err error) {
	select {
	case slot <- struct{}{}:
		defer func() { <-slot }()
	case <-ctx.Done():
		return nil, false, ctx.Err()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(url.Values{"data": {query}}.Encode()))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, ctx.Err() == nil, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		els, err = Parse(resp.Body)
		return els, false, err
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		retry = true
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return nil, retry, fmt.Errorf("overpass: HTTP %d", resp.StatusCode)
}

// Parse lit une réponse Overpass JSON.
func Parse(r io.Reader) ([]Element, error) {
	var body struct {
		Remark   string    `json:"remark"`
		Elements []Element `json:"elements"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return nil, fmt.Errorf("overpass: %w", err)
	}
	// Overpass répond 200 avec une remarque quand la requête a expiré : réponse incomplète.
	if strings.Contains(body.Remark, "runtime error") {
		return nil, fmt.Errorf("overpass: %s", body.Remark)
	}
	return body.Elements, nil
}
