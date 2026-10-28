package irve

import (
	"regexp"
	"strconv"
	"strings"
)

// Le champ « tarification » du schéma IRVE est un texte libre : la plupart des opérateurs y
// écrivent une phrase sans montant (« Les tarifs de recharge peuvent varier… »). On n'en
// garde un prix que s'il est écrit en euros (ou centimes) par kWh, sans deviner d'unité.
var perKWh = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(€|eur(?:os?)?|e|cts?|c€|centimes?)\s*(?:ttc\s*)?/\s*kwh`)

// D'autres frais que le kWh (minute, session, connexion) : le prix affiché est un minimum.
var extraFees = regexp.MustCompile(`(?i)/\s*min|minute|session|connexion|\+`)

// parsePrice renvoie le prix au kWh en euros ; from vaut true si d'autres frais s'y ajoutent.
func parsePrice(s string) (eurPerKWh float64, from bool, ok bool) {
	m := perKWh.FindStringSubmatch(s)
	if m == nil {
		return 0, false, false
	}
	v, err := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
	if err != nil {
		return 0, false, false
	}
	if u := strings.ToLower(m[2]); strings.HasPrefix(u, "c") {
		v /= 100
	}
	// Au-delà, c'est une faute de saisie (centimes écrits en euros…), pas un prix.
	if v < 0.05 || v > 1.5 {
		return 0, false, false
	}
	return v, extraFees.MatchString(s), true
}
