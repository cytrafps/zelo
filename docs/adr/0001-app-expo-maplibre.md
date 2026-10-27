# 0001. App en Expo + MapLibre, en development build

Statut : Acceptée
Date : 2026-10-26 (PR #1)

## Contexte

Une seule base de code pour iOS et Android, une carte vectorielle fluide avec des milliers de points, et des composants natifs (feuilles, sélecteurs). Expo Go n'embarque pas MapLibre.

## Décision

Expo SDK 58 avec MapLibre React Native 11, en development build EAS. Feuilles et contrôles natifs avec `@expo/ui`. Fond de carte OpenFreeMap pour le prototype.

## Conséquences

- Un build natif (EAS) est nécessaire à chaque changement de dépendance native ; `npm run dev` le détecte par empreinte.
- Hermes n'a pas `Intl.RelativeTimeFormat` : le formatage des durées est fait à la main (PR #9).
- À terme : tuiles PMTiles auto-hébergées pour ne plus dépendre d'un fond tiers.
