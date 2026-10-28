// Package evdata : caractéristiques des voitures électriques (batterie utilisable, consommation
// moyenne, puissances de charge, prises), tirées d'Open EV Data
// (https://github.com/KilowattApp/open-ev-data, licence MIT avec attribution). Régénérer avec
// update.py ; l'app estime l'autonomie à l'arrivée sur le téléphone.
package evdata

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
)

//go:embed models.json
var raw []byte

// JSON : la liste telle que servie par l'API, et son empreinte pour les ETag.
var JSON, ETag = func() ([]byte, string) {
	var check struct {
		Models []struct {
			ID         string  `json:"id"`
			BatteryKwh float64 `json:"batteryKwh"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &check); err != nil || len(check.Models) == 0 {
		panic("evdata: models.json illisible")
	}
	sum := sha256.Sum256(raw)
	return raw, `"` + hex.EncodeToString(sum[:8]) + `"`
}()
