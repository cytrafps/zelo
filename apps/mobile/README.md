# Zelo · app mobile

React Native + Expo SDK 58, Expo Router, carte MapLibre.

Ce prototype affiche autour de Reims :

- les stations-service et leurs prix ;
- les bornes de recharge et le nombre de points libres ;
- les parkings publics, avec leurs places, leur tarif (payant ou gratuit) et leur hauteur maximale ;
- les signalements, reçus en temps réel par WebSocket.

Le bouton « Signaler » publie un événement à ta position.

## Lancer sur ton téléphone Android

Depuis la racine du dépôt :

```sh
npm run dev
```

MapLibre contient du code natif : l'app tourne dans un **development build**, pas dans Expo Go. Au premier lancement, le script te connecte à ton compte Expo (gratuit), lie le projet (`app.json` reçoit un `projectId`, à committer), puis construit l'APK dans le cloud EAS en 15 minutes environ. Scanne le QR code du build pour installer l'app Zelo, puis celui de Metro pour la charger. Ensuite, chaque changement de code arrive en direct ; un nouveau build n'est lancé que si une dépendance native change.

Si le téléphone n'atteint pas l'API :
- vérifie qu'il est sur le même Wi-Fi que le PC (pas un réseau invité) ;
- sous Windows, autorise Docker Desktop et Node.js dans le pare-feu, pour les réseaux privés.

iPhone : un development build demande un compte Apple Developer payant (99 €/an).

## Organisation

| Chemin | Rôle |
|---|---|
| `src/app/` | Routes Expo Router uniquement |
| `src/screens/map/` | Écran carte : couches, feuille station, feuille « Signaler » |
| `src/api/zelo.ts` | Client de l'API et types partagés |
| `src/hooks/` | Données de la vue (`use-map-data`), flux temps réel (`use-live`), position (`use-user-location`) |
| `src/theme.ts` | Jetons de l'interface (variables Figma) |

## Choix

- **Chargement par zone.** La zone chargée est la vue agrandie de 50 %, arrondie au centième pour profiter du cache HTTP. Pas de nouvelle requête tant que la vue reste dedans, et la requête précédente est annulée si la carte bouge encore. Au-delà de 1° de côté, la limite de l'API, l'app demande de zoomer.
- **Temps réel.** Une seule connexion WebSocket. Elle se reconnecte avec une attente exponentielle et se coupe en arrière-plan. Au retour, l'app recharge les signalements pour combler la coupure.
- **Rendu.** Les points sont des couches GeoJSON MapLibre dessinées par le moteur natif, pas des vues React. Des milliers de points restent fluides.
- **Fond de carte.** OpenFreeMap (OpenStreetMap, gratuit, sans clé) pour le prototype, à remplacer par nos tuiles PMTiles auto-hébergées.

## Vérifier

```sh
npm run typecheck && npm run lint && npx expo-doctor
```
