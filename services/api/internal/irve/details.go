package irve

import (
	"regexp"
	"strconv"
	"strings"
)

func pmr(v string) string {
	switch v {
	case "Accessible mais non réservé PMR":
		return "accessible"
	case "Réservé PMR":
		return "réservé"
	case "Non accessible":
		return "non"
	}
	return "" // « Accessibilité inconnue » ou vide
}

func placement(v string) string {
	switch v {
	case "Voirie":
		return "voirie"
	case "Parking public", "Parking privé à usage public":
		return "parking"
	case "Parking privé réservé à la clientèle":
		return "parking-clients"
	case "Station dédiée à la recharge rapide":
		return "recharge-rapide"
	}
	return ""
}

var heightRe = regexp.MustCompile(`(?i)^\s*(?:hauteur\s+(?:maximale|maximum|max\.?)(?:\s+si\s+barri[eè]re)?\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*m?\s*$`)

// maxHeight lit « Hauteur maximale 1.90m », « Hauteur maximum 2m », « 2,3m » ou « 1.9 ». Le champ
// est un texte libre : tout ce qui n'est pas une hauteur plausible de véhicule (1,6 à 4,5 m :
// « 15m² », « 99999 », « 0 ») est ignoré.
func maxHeight(v string) *float64 {
	m := heightRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return nil
	}
	h, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
	if err != nil || h < 1.6 || h > 4.5 {
		return nil
	}
	return &h
}
