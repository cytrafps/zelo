# 0002. Parkings depuis OpenStreetMap, pas la base nationale

Statut : Acceptée
Date : 2026-10-26 (PR #2)

## Contexte

La base nationale des lieux de stationnement compte 826 lignes pour toute la France et aucun parking à Reims. Aucune source publique ne donne les places libres en temps réel à Reims.

## Décision

Import quotidien des parkings publics depuis OpenStreetMap (API Overpass), avec l'attribution « © contributeurs OpenStreetMap » (licence ODbL).

## Conséquences

- 105 parkings importés sur la zone de Reims au premier import réel.
- Capacité connue quand OSM la renseigne, pas d'occupation en direct : demande en cours auprès du Grand Reims.
