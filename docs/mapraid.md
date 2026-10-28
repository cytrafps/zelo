# Mapraid Zelo à Reims

Une après-midi de cartographie OpenStreetMap à plusieurs, sur le modèle des « mapraids » de la
communauté Waze. Zelo lit ses parkings, ses arceaux vélo, ses places motos et ses feux dans OSM :
chaque contribution améliore directement l'app, et profite aussi à tous les autres usages d'OSM.

## Ce qui manque (extrait OSM de la Marne, 28 octobre 2026, Reims intra-rocade)

| Donnée | État | Effet dans Zelo |
|---|---|---|
| Parkings publics sans nombre de places (`capacity`) | 1 106 sur 1 262 | « Places : non renseigné » sur la fiche |
| Parkings publics sans `fee` (payant ou gratuit) | 1 110 sur 1 262 | Tarif inconnu, pas de filtre « gratuit » possible |
| Parkings payants sans tarif (`charge`) | 51 | Pas de prix affiché hors grilles CPA et Effia |
| Parkings nommés | 47 sur 1 262 | Liste d'arrêts proposée moins lisible |
| Places motos (`amenity=motorcycle_parking`) | 3, dont 2 privées | À moto, Zelo propose surtout des parkings voiture |
| Arceaux vélo sans nombre de places | 23 sur 1 048 | Bonne couverture, finitions seulement |

## Déroulé (3 h)

1. **30 min, prise en main.** Compte OSM, éditeur iD dans le navigateur ou StreetComplete sur
   Android : ce dernier pose justement les questions « payant ? », « combien de places ? » sur
   le terrain.
2. **2 h, terrain par binômes.** Un quartier chacun (hypercentre, gare, Saint-Remi, Clairmarais,
   Croix-Rouge), StreetComplete ouvert. Priorités, dans l'ordre :
   - `fee` et `capacity` des parkings ;
   - les places motos : chaque emplacement marqué au sol, avec `capacity` ;
   - `charge` (ex. `2.00 EUR/hour`) quand le tarif est affiché à l'horodateur.
3. **30 min, relecture.** Vérifier les modifications de chacun sur
   [OSMCha](https://osmcha.org/), avec le mot-dièse `#ZeloReims` dans les commentaires.

## Après

Zelo réimporte OSM chaque nuit : le lendemain, les nouvelles données sont dans l'app. Les chiffres
ci-dessus se recalculent depuis l'extrait de la Marne pour mesurer le résultat.

Règles OSM à respecter : on ne cartographie que ce qu'on voit sur place, ou ce qu'on lit sur une
source compatible avec la licence ODbL. Jamais de copie depuis Google Maps ou le site d'un
exploitant.
