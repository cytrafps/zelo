package irve

import (
	"strings"
	"testing"
)

const staticCSV = `nom_operateur,nom_enseigne,id_station_itinerance,nom_station,adresse_station,coordonneesXY,id_pdc_itinerance,puissance_nominale,prise_type_ef,prise_type_2,prise_type_combo_ccs,prise_type_chademo,prise_type_autre,gratuit,paiement_cb,horaires,consolidated_longitude,consolidated_latitude,consolidated_is_lon_lat_correct
IZIVIA,Izivia,FRS1,Reims Leclerc,"Bd Leclerc 51100 Reims","[4.03, 49.25]",FRP1,150,false,false,true,false,false,false,true,24/7,4.031,49.251,True
IZIVIA,Izivia,FRS1,Reims Leclerc,"Bd Leclerc 51100 Reims","[4.03, 49.25]",FRP1,150,false,false,true,false,false,false,true,24/7,4.031,49.251,True
Freshmile,,FRS2,Erlon,"Pl. d'Erlon 51100 Reims","[4.02, 49.26]",FRP2,22000,false,true,false,false,false,true,false,,,,False
Autre,,FRS3,Paris,"Paris","[2.35, 48.85]",FRP3,50,false,true,false,false,false,false,false,,,,
`

func TestParseStatic(t *testing.T) {
	reims := BBox{MinLon: 3.9, MinLat: 49.2, MaxLon: 4.2, MaxLat: 49.3}
	got, err := ParseStatic(strings.NewReader(staticCSV), reims)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("points = %d, want 2 (doublon et hors zone ignorés)", len(got))
	}
	a, b := got[0], got[1]
	if a.Lon != 4.031 || a.Lat != 49.251 {
		t.Errorf("coordonnées consolidées non utilisées : %v, %v", a.Lon, a.Lat)
	}
	if a.Operator != "Izivia" || a.PowerKW != 150 || len(a.Sockets) != 1 || a.Sockets[0] != "ccs" || !a.CardPayment {
		t.Errorf("point A = %+v", a)
	}
	if b.Lon != 4.02 || b.PowerKW != 22 || !b.Free || b.Operator != "Freshmile" {
		t.Errorf("point B = %+v (puissance en W à convertir, coordonnées brutes)", b)
	}
}

const dynamicCSV = `id_pdc_itinerance,etat_pdc,occupation_pdc,horodatage
FRP1,en_service,libre,2026-10-26 09:10:54.249000+00:00
FRP1,en_service,occupe,2026-10-26 08:00:00+00:00
FRP2,hors_service,,2026-10-25 20:53:27+00:00
FRP3,en_service,libre,pas une date
`

func TestParseDynamic(t *testing.T) {
	got, err := ParseDynamic(strings.NewReader(dynamicCSV))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("états = %d, want 2", len(got))
	}
	byID := map[string]Status{}
	for _, s := range got {
		byID[s.ID] = s
	}
	if s := byID["FRP1"]; s.Occupancy != "libre" || s.ObservedAt.Hour() != 9 {
		t.Errorf("FRP1 doit garder l'état le plus récent : %+v", s)
	}
	if s := byID["FRP2"]; s.State != "hors_service" || s.Occupancy != "inconnu" {
		t.Errorf("FRP2 = %+v", s)
	}
}
