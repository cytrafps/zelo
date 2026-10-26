<p align="center">
  <img src="docs/banner.png" alt="Zelo, l'app de la fin du trajet : se garer, recharger, faire le plein" width="100%">
</p>

<p align="center">
  <a href="https://github.com/cytrafps/zelo/actions/workflows/ci.yml"><img src="https://github.com/cytrafps/zelo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/Expo-SDK%2058-000020?logo=expo&logoColor=white" alt="Expo SDK 58">
  <img src="https://img.shields.io/badge/PostGIS-17-336791?logo=postgresql&logoColor=white" alt="PostGIS 17">
  <img src="https://img.shields.io/badge/donn%C3%A9es-ouvertes-16A34A" alt="Données ouvertes">
</p>

# Zelo

L'app de la fin du trajet : se garer, recharger, faire le plein, retrouver sa voiture.
Projet annuel B3, ESGI Reims (spécialité Systèmes, Réseaux et Cloud).

## Architecture

```mermaid
flowchart LR
  subgraph Sources["Données ouvertes"]
    F["Prix des carburants<br/>toutes les 10 min"]
    B["Bornes IRVE<br/>statique 24 h · dynamique 5 min"]
    O["OpenStreetMap<br/>parkings, 24 h"]
  end
  subgraph Serveur["services/api (Go)"]
    J["Collecte planifiée"]
    A["API REST"]
    W["WebSocket /v1/live"]
  end
  DB[("PostgreSQL + PostGIS")]
  App["App mobile<br/>Expo + MapLibre"]

  F --> J
  B --> J
  O --> J
  J --> DB
  A <--> DB
  App -- "GET stations, bornes, parkings" --> A
  App -- "POST signalement" --> A
  A -- "diffusion" --> W
  W -- "temps réel" --> App
```

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `services/api` | API en Go : collecte des données ouvertes, API REST, signalements en temps réel (WebSocket), métriques Prometheus |
| `apps/mobile` | App React Native + Expo : carte MapLibre, stations, bornes, parkings, signalements en temps réel |
| `infra` | Environnement de développement (Docker Compose) ; manifestes K3s et Argo CD à venir |

## Démarrer

Prérequis : Node 20.19+ (22 LTS conseillé) et Docker Desktop. Téléphone Android sur le même Wi-Fi que le PC.

```sh
npm run dev     # API + base, dépendances, compte Expo, build Android si besoin, puis QR code à scanner
npm run stop    # arrête l'API et la base (les données restent)
```

Le script `scripts/dev.mjs` fait tout dans l'ordre :

1. Il vérifie Node et Docker, puis trouve l'IP du PC sur le Wi-Fi.
2. Il lance l'API et attend la première collecte de chaque source.
3. Il installe les dépendances de l'app.
4. Il te connecte à Expo.
5. Il refait le development build Android seulement si la partie native a changé : il compare l'empreinte Expo du projet.
6. Il démarre Metro, avec l'adresse de l'API déjà réglée.

Options : `npm run dev -- --rebuild` force un nouveau build, `npm run dev -- --ip 192.168.1.20` impose l'IP du PC.

API seule :

```sh
docker compose -f infra/compose.yaml up --build
```

Au démarrage, l'API crée le schéma PostGIS puis collecte les sources. Ensuite :

```sh
curl "localhost:8080/v1/fuel-stations?bbox=3.98,49.22,4.08,49.28"     # stations + prix
curl "localhost:8080/v1/charge-stations?bbox=3.98,49.22,4.08,49.28"    # bornes + disponibilité
curl -X POST localhost:8080/v1/reports -d '{"kind":"accident","lat":49.2535,"lon":4.0322}'
```

Développement de l'API sans Docker (Go 1.26 et une base PostGIS) :

```sh
cd services/api
go test ./...
DATABASE_URL=postgres://zelo:zelo@localhost:5432/zelo?sslmode=disable go run ./cmd/api
go run ./cmd/api -once   # collecte une fois toutes les sources puis quitte
```

## API

| Méthode et route | Description |
|---|---|
| `GET /v1/fuel-stations?bbox=minLon,minLat,maxLon,maxLat` | Stations et prix par carburant (zone de 1° de côté maximum, 500 résultats) |
| `GET /v1/charge-stations?bbox=…` | Stations de recharge : puissance max, prises, points de charge, nombre de points libres (`null` si aucun état publié depuis 24 h) |
| `GET /v1/parkings?bbox=…` | Parkings publics : places, payant ou gratuit, hauteur max, places PMR et recharge, horaires (plus grands d'abord) |
| `GET /v1/reports?bbox=…` | Signalements encore actifs |
| `POST /v1/reports` | `{"kind", "lat", "lon"}` ; types : `accident`, `travaux`, `bouchon`, `obstacle`, `route_fermee`, `place_liberee`, `borne_hs` ; 5 par IP puis 1 toutes les 12 s |
| `GET /v1/live` | WebSocket : chaque nouveau signalement est poussé aux clients |
| `GET /healthz`, `GET /metrics` | Santé et métriques Prometheus |

Aucun signalement de contrôle de police ni de radar n'est accepté (décret 2012-3, article R413-15 du code de la route).

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | (obligatoire) | Connexion PostgreSQL + PostGIS |
| `ADDR` | `:8080` | Adresse d'écoute |
| `IMPORT_BBOX` | vide (France entière) | Zone d'import des bornes et des parkings (obligatoire pour les parkings) |
| `TRUST_PROXY` | `false` | Lire l'IP cliente dans `CF-Connecting-IP` (derrière Cloudflare) |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Instance Overpass pour l'import des parkings (exige `IMPORT_BBOX`) |
| `WS_ORIGINS` | vide | Origines web autorisées pour le WebSocket (ex. `dashboard.zelo.app`) |

## Sources de données

| Source | Fréquence | Licence |
|---|---|---|
| [Prix des carburants](https://www.prix-carburants.gouv.fr/rubrique/opendata/) | 10 min | Licence Ouverte 2.0 |
| [Bornes IRVE statiques](https://transport.data.gouv.fr/datasets/685965d0ab901919e14a4a1b) | 24 h | Licence Ouverte 2.0 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass (parkings) | 24 h | ODbL (attribution « © contributeurs OpenStreetMap ») |
| [Bornes IRVE dynamiques](https://transport.data.gouv.fr/) (bêta) | 5 min | Licence Ouverte 2.0 |
