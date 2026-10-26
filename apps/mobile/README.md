# Zelo · app mobile

React Native + Expo SDK 58, Expo Router, carte MapLibre.

Ce prototype affiche autour de Reims :

- les stations-service et leurs prix ;
- les bornes de recharge et le nombre de points libres ;
- les parkings publics, avec leurs places, leur tarif (payant ou gratuit) et leur hauteur maximale ;
- les signalements, reçus en temps réel par WebSocket.

Le bouton « Signaler » publie un événement à ta position.

## Lancer sur ton téléphone Android

MapLibre contient du code natif : l'app tourne dans un **development build**, pas dans Expo Go. On le construit une fois dans le cloud EAS, sans Android Studio ; ensuite, tout changement de code JS arrive en direct.

Une seule fois :

```sh
npx eas-cli@latest login                                   # compte Expo gratuit
npx eas-cli@latest init                                    # lie le projet au compte (ajoute projectId dans app.json)
npx eas-cli@latest build -p android --profile development  # ~15 min, donne un lien et un QR code vers l'APK
```

Scanne le QR code avec le téléphone et installe l'APK. Ensuite, à chaque session :

```sh
docker compose -f ../../infra/compose.yaml up --build      # API + PostGIS
EXPO_PUBLIC_API_URL=http://<ip-de-ton-pc>:8080 npm start   # puis scanne le QR code depuis l'app Zelo
```

Le téléphone et le PC doivent être sur le même Wi-Fi ; `localhost` désigne le téléphone, d'où l'IP du PC. Un nouveau build n'est nécessaire que si on ajoute une dépendance native.

iPhone : un development build demande un compte Apple Developer payant (99 €/an) ; à défaut, on teste sur Android.

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
