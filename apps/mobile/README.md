# Zelo · app mobile

React Native + Expo SDK 58, Expo Router, carte MapLibre.

Ce prototype affiche autour de Reims :

- les stations-service et leurs prix ;
- les bornes de recharge et le nombre de points libres ;
- les signalements, reçus en temps réel par WebSocket.

Le bouton « Signaler » publie un événement à ta position.

## Lancer

MapLibre contient du code natif : l'app tourne dans un **development build**, pas dans Expo Go.

```sh
docker compose -f ../../infra/compose.yaml up --build   # API + PostGIS, depuis apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://<ip-de-ton-pc>:8080 npm run android   # ou npm run ios (Mac)
```

Sur un téléphone physique, `localhost` désigne le téléphone : mets l'IP de ton ordinateur sur le même Wi-Fi. Sur l'émulateur Android, mets `http://10.0.2.2:8080`.

Avec EAS (sans Android Studio ni Xcode) : `npx eas-cli@latest build --profile development`.

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
