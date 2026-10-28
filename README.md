<p align="center">
  <img src="docs/assets/banner.png" alt="Zelo, l'app de la fin du trajet : se garer, recharger, faire le plein" width="100%">
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

**Le parcours** : choisir une destination, ou toucher un parking, une borne, une station. Zelo propose où s'arrêter, avec le prix et la marche jusqu'à destination. L'aperçu montre jusqu'à trois itinéraires, l'heure d'arrivée marche comprise et les signalements sur le chemin. Le guidage suit la voiture, recalcule l'itinéraire si on s'écarte, puis enregistre la voiture au parking et continue à pied.

## Architecture

```mermaid
flowchart LR
  subgraph Sources["Données ouvertes"]
    F["Prix des carburants<br/>toutes les 10 min"]
    B["Bornes IRVE<br/>statique 24 h · dynamique 5 min"]
    O["OpenStreetMap<br/>parkings, feux, stops, aires, 24 h"]
  end
  subgraph Serveur["services/api (Go)"]
    J["Collecte planifiée"]
    A["API REST"]
    W["WebSocket /v1/live"]
  end
  V["Valhalla<br/>itinéraires, graphe de la Marne"]
  DB[("PostgreSQL + PostGIS")]
  App["App mobile<br/>Expo + MapLibre"]

  F --> J
  B --> J
  O --> J
  J --> DB
  A <--> DB
  App -- "GET stations, bornes, parkings" --> A
  App -- "POST signalement" --> A
  App -- "GET itinéraire" --> A
  A -- "calcul" --> V
  A -- "diffusion" --> W
  W -- "temps réel" --> App
```

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `services/api` | API en Go : collecte des données ouvertes, API REST, signalements en temps réel (WebSocket), métriques Prometheus |
| `services/valhalla` | Image Valhalla (itinéraires) avec le graphe routier de la Marne, reconstruite chaque semaine par la CI |
| `apps/mobile` | App React Native + Expo : carte MapLibre, stations, bornes, parkings, signalements en temps réel |
| `infra` | Développement (Docker Compose) et homelab décrit en code : VM Proxmox en Terraform, cluster K3s en Ansible ([guide](infra/README.md)) |
| `deploy` | Production sur K3s en GitOps : Kustomize, Argo CD, Prometheus et Grafana ([guide](deploy/README.md)) |
| `tests/charge` | Test de charge k6 et résultats, bascule d'une réplique comprise ([résultats](tests/charge/README.md)) |
| `docs` | [Décisions d'architecture](docs/adr/README.md) et visuels |

Branches, commits et PR : voir [CONTRIBUTING.md](CONTRIBUTING.md).

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

**PC sans Docker** (Windows allégé sans WSL, par exemple) : fais tourner l'API sur une autre machine du réseau, puis pointe l'app dessus.

```sh
# Sur une VM Linux (Ubuntu Server sur Proxmox par exemple)
curl -fsSL https://get.docker.com | sh
git clone https://github.com/cytrafps/zelo && cd zelo
docker compose -f infra/compose.yaml up -d --build

# Sur le PC
npm run dev -- --api http://<ip-de-la-vm>:8080
```

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

### API accessible depuis Internet (HTTPS, téléphone en 4G)

Cloudflare Tunnel publie l'API en HTTPS sans ouvrir de port sur ta box : `cloudflared` se connecte vers Cloudflare, rien ne rentre. Les WebSocket passent aussi.

**Pour tester tout de suite, sans compte.** Cloudflare donne une adresse aléatoire en `trycloudflare.com`, nouvelle à chaque redémarrage :

```sh
echo "TRUST_PROXY=true" > infra/.env        # quota de signalements par vraie IP client
docker compose -f infra/compose.yaml --profile tunnel-rapide up -d
docker compose -f infra/compose.yaml logs tunnel-rapide | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

Ensuite, sur le PC : `npm run dev -- --api https://….trycloudflare.com --tunnel`. Avec `--tunnel`, le code de l'app passe aussi par un tunnel Expo : le téléphone peut être en 4G.

**Adresse fixe sur ton domaine**, pour la démo et l'APK à partager. Le domaine doit être géré par Cloudflare.

1. Dans Cloudflare Zero Trust, va dans **Networks → Tunnels → Create a tunnel** et choisis Cloudflared. Copie le jeton.
2. Dans l'onglet *Public Hostname*, crée `api.<ton-domaine>` vers le service `http://api:8080`.
3. Lance le tunnel :
   ```sh
   printf 'TRUST_PROXY=true\nTUNNEL_TOKEN=<jeton>\n' > infra/.env   # .env est ignoré par Git
   docker compose -f infra/compose.yaml --profile tunnel up -d
   ```

**APK autonome à partager** (équipe, jury) : elle embarque l'adresse de l'API et n'a besoin ni du PC ni de Metro.

```sh
cd apps/mobile
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://api.<ton-domaine> --visibility plaintext
npx eas-cli@latest build -p android --profile preview
```

## API

| Méthode et route | Description |
|---|---|
| `GET /v1/fuel-stations?bbox=minLon,minLat,maxLon,maxLat` | Stations et prix par carburant (zone de 1° de côté maximum, 500 résultats) |
| `GET /v1/charge-stations?bbox=…` | Stations de recharge : puissance max, prises, points de charge, nombre de points libres (`null` si aucun état publié depuis 24 h), prix au kWh quand l'opérateur le publie |
| `GET /v1/parkings?bbox=…` | Parkings publics : places, payant ou gratuit, hauteur max, places PMR et recharge, horaires, tarifs pour 1 h, 3 h et 24 h quand ils ont été relevés (plus grands d'abord) |
| `GET /v1/reports?bbox=…` | Signalements encore actifs |
| `POST /v1/reports` | `{"kind", "lat", "lon"}` ; types : `accident`, `travaux`, `bouchon`, `obstacle`, `route_fermee`, `place_liberee`, `borne_hs` ; 5 par IP puis 1 toutes les 12 s |
| `POST /v1/reports/{id}/votes` | `{"up": true}` (toujours là) ou `false` (plus là) ; un vote par appareil (`X-Zelo-Device`), modifiable ; jamais sur son propre signalement (409) |
| `GET /v1/route?from=lat,lon&to=lat,lon&mode=car\|walk` | `{"routes": […]}`, du plus rapide au plus lent : distance (m), durée (s), tracé `[lon, lat]`, étapes en français ; en voiture, `areas` liste les aires d'autoroute desservies (distance, services, prix du carburant, bornes libres) et chaque étape peut porter `control` (`feu`, `stop` : « Au feu, tournez… ») et `lanes` (voies à l'approche, `take` sur celles à prendre). Options : `alternates=0..2`, `heading` (cap au départ, en °), `depart` (heure Unix, 7 jours au plus), `avoid=tolls,highways`. 422 hors de la zone couverte ; 20 par IP puis 1 par seconde |
| `GET /v1/live` | WebSocket : `report` (nouveau ou mis à jour) et `report_removed` sont poussés à tous les clients, quelle que soit l'instance |
| `GET /healthz`, `GET /metrics` | Santé et métriques Prometheus (collectes, trafic par route, calculs d'itinéraire) |

Fiabilité des signalements, comme sur Waze :
- un signalement du même type à moins de 150 m d'un signalement actif n'en crée pas un second, il le confirme ;
- chaque « toujours là » prolonge le signalement de la moitié de sa durée de vie ;
- dès que 2 personnes ou plus disent « plus là » et qu'elles sont plus nombreuses que celles qui confirment, il disparaît pour tout le monde ;
- l'identifiant d'appareil est aléatoire et sans compte, et le serveur n'en garde qu'une empreinte.

Aucun signalement de contrôle de police ni de radar n'est accepté (décret 2012-3, article R413-15 du code de la route).

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | (obligatoire) | Connexion PostgreSQL + PostGIS |
| `ADDR` | `:8080` | Adresse d'écoute |
| `IMPORT_BBOX` | vide (France entière) | Zone d'import des bornes, des parkings, des feux et des stops (obligatoire pour ces deux derniers) |
| `TRUST_PROXY` | `false` | Lire l'IP cliente dans `CF-Connecting-IP` (derrière Cloudflare) |
| `AREAS_BBOX` | `IMPORT_BBOX` | Zone d'import des aires d'autoroute (OSM), à caler sur celle du graphe routier |
| `TRUSTED_PROXIES` | vide | Réseaux des proxys de confiance (ex. `10.42.0.0/16`, Traefik sur K3s) : l'IP cliente est lue dans `X-Forwarded-For` |
| `LIVE_MAX_CLIENTS` | `5000` | Clients du flux temps réel par instance, au-delà refusés (le client réessaie) |
| `GOMEMLIMIT` | vide | Limite mémoire visée par Go, à ~90 % de la limite du conteneur |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Instance Overpass pour l'import des parkings (exige `IMPORT_BBOX`) |
| `WS_ORIGINS` | vide | Origines web autorisées pour le WebSocket (ex. `dashboard.zelo.app`) |
| `VALHALLA_URL` | vide (itinéraires désactivés) | Service Valhalla, ex. `http://valhalla:8002` ; jamais exposé directement |

## Sources de données

| Source | Fréquence | Licence |
|---|---|---|
| [Prix des carburants](https://www.prix-carburants.gouv.fr/rubrique/opendata/) | 10 min | Licence Ouverte 2.0 |
| [OpenStreetMap, extrait de la Marne](https://download.openstreetmap.fr/extracts/europe/france/champagne_ardenne/) (itinéraires) | 7 j | ODbL |
| [Bornes IRVE statiques](https://transport.data.gouv.fr/datasets/685965d0ab901919e14a4a1b) | 24 h | Licence Ouverte 2.0 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass (parkings, feux et stops, aires d'autoroute) | 24 h | ODbL (attribution « © contributeurs OpenStreetMap ») |
| [Bornes IRVE dynamiques](https://transport.data.gouv.fr/) (bêta) | 5 min | Licence Ouverte 2.0 |
| Tarifs des parkings du centre, relevés sur les sites de [Champagne Parc Auto](https://www.cpa-champagneparcauto.com/parkings/) et d'[Effia](https://www.effia.com/) | À la main, datés | Seul le tarif affiché sur place fait foi |
