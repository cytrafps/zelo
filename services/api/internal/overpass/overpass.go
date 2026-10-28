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
}

// Fetch envoie la requête Overpass QL et renvoie ses éléments.
func Fetch(ctx context.Context, client *http.Client, endpoint, query string) ([]Element, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(url.Values{"data": {query}}.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil, fmt.Errorf("overpass: HTTP %d", resp.StatusCode)
	}
	return Parse(resp.Body)
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
