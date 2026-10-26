# Zelo

L'app de la fin du trajet : se garer, recharger, faire le plein, retrouver sa voiture.
Projet annuel B3, ESGI Reims (spécialité Systèmes, Réseaux et Cloud).

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `services/api` | API en Go : collecte des données ouvertes, API REST, signalements en temps réel (WebSocket), métriques Prometheus |
| `apps/mobile` | App React Native + Expo : carte MapLibre, stations, bornes, signalements en temps réel |
| `infra` | Environnement de développement (Docker Compose) ; manifestes K3s et Argo CD à venir |

## Démarrer

Prérequis : Docker.

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
| `IMPORT_BBOX` | vide (France entière) | Limite l'import des bornes à une zone |
| `TRUST_PROXY` | `false` | Lire l'IP cliente dans `CF-Connecting-IP` (derrière Cloudflare) |
| `WS_ORIGINS` | vide | Origines web autorisées pour le WebSocket (ex. `dashboard.zelo.app`) |

## Sources de données

| Source | Fréquence | Licence |
|---|---|---|
| [Prix des carburants](https://www.prix-carburants.gouv.fr/rubrique/opendata/) | 10 min | Licence Ouverte 2.0 |
| [Bornes IRVE statiques](https://transport.data.gouv.fr/datasets/685965d0ab901919e14a4a1b) | 24 h | Licence Ouverte 2.0 |
| [Bornes IRVE dynamiques](https://transport.data.gouv.fr/) (bêta) | 5 min | Licence Ouverte 2.0 |
