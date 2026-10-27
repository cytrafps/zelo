# 0009. Itinéraires calculés par Valhalla auto-hébergé

Statut : Acceptée
Date : 2026-10-27

## Contexte

Le parcours principal (aperçu, guidage, fin à pied) demande des itinéraires voiture et piéton en français. Une API commerciale facture chaque calcul et voit les trajets des utilisateurs.

## Décision

Valhalla tourne à côté de l'API, sur le graphe routier OpenStreetMap de la Marne. La CI reconstruit le graphe chaque semaine et l'embarque dans une image (`services/valhalla`) ; l'API relaie `GET /v1/route` en imposant le français et une distance d'accroche de 500 m. Valhalla n'est joignable que depuis l'API.

## Conséquences

- Mesuré le 27/10/2026 : graphe construit en 30 s, 40 Mo de mémoire au repos, itinéraire en 11 ms (p95 25 ms).
- Les trajets ne quittent pas notre infrastructure.
- Une destination hors de la Marne répond 422 ; couvrir plus large = un extrait plus grand (Grand Est), au prix d'environ 1 Go de mémoire.
- Le point de départ peut s'accrocher à la mauvaise voie (demi-tour inutile) : l'app enverra le cap du téléphone.
