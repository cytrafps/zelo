package evdata

import (
	"encoding/json"
	"testing"
)

func TestModels(t *testing.T) {
	var d struct {
		Models []struct {
			Brand, Model string
			BatteryKwh   float64 `json:"batteryKwh"`
			KwhPer100km  float64 `json:"kwhPer100km"`
		} `json:"models"`
	}
	if err := json.Unmarshal(JSON, &d); err != nil || len(d.Models) < 1000 {
		t.Fatalf("%d modèles, %v", len(d.Models), err)
	}
	for _, m := range d.Models {
		if m.BatteryKwh < 5 || m.BatteryKwh > 250 || m.KwhPer100km < 6 || m.KwhPer100km > 40 {
			t.Errorf("%s %s : batterie %.1f kWh, %.1f kWh/100 km invraisemblables", m.Brand, m.Model, m.BatteryKwh, m.KwhPer100km)
		}
	}
}
