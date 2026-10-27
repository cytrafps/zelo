# Contribuer à Zelo

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `apps/mobile` | App iOS et Android (Expo, React Native, MapLibre) |
| `services/api` | API Go : collecte des données ouvertes, REST, temps réel, métriques |
| `services/valhalla` | Image Valhalla (itinéraires) et construction du graphe routier |
| `deploy` | Manifestes Kubernetes (Kustomize), Argo CD, supervision |
| `infra` | Environnement de développement (Docker Compose, tunnel Cloudflare) |
| `scripts` | `npm run dev` : tout lancer en une commande |
| `tests` | Tests transverses (charge, bascule) |
| `docs` | [Décisions d'architecture](docs/adr/README.md) et visuels |

Les tests unitaires vivent à côté du code qu'ils testent (`*_test.go`, `*.test.ts`).

## Branches

`main` est toujours déployable : chaque fusion part en production (Argo CD). On n'y pousse jamais directement.

Une branche par sujet, courte (quelques jours au plus), créée depuis `main` :

```
type/sujet-en-kebab-case
```

| Type | Pour |
|---|---|
| `feat` | une fonctionnalité visible (app ou API) |
| `fix` | une correction de bug |
| `perf` | une amélioration de performance mesurée |
| `refactor` | du code réorganisé sans changement de comportement |
| `test` | des tests seuls |
| `docs` | documentation, décisions d'architecture |
| `ci` | GitHub Actions |
| `deploy` | manifestes Kubernetes, supervision |
| `chore` | outillage, dépendances, rangement |

Exemples : `feat/itineraire-parking`, `fix/hermes-intl`, `deploy/alerte-latence`.

Pas de branche `develop` : avec un déploiement continu depuis `main`, une branche d'intégration de plus ne ferait que retarder les conflits.

## Commits et pull requests

Messages au format [Conventional Commits](https://www.conventionalcommits.org/fr/), en français, à l'impératif :

```
feat(mobile): affiche le prix du gazole sous chaque station
fix(api): sérialise l'application du schéma entre répliques
```

Portées : `api`, `mobile`, `deploy`, `infra`, `ci`, `docs`.

1. Ouvrir la PR tôt, en brouillon si besoin. Le titre suit le même format que les commits : la CI le vérifie, ainsi que le nom de la branche.
2. La CI doit être verte : tests Go avec PostGIS, typage, lint et tests de l’app, rendu Kubernetes et règles Prometheus.
3. Fusion en **squash** : un commit par PR sur `main`, avec le titre de la PR. La branche est supprimée automatiquement.

Une décision qui engage l'architecture (nouveau composant, nouvelle source de données, donnée personnelle) s'accompagne d'une [ADR](docs/adr/README.md) dans la même PR.

## Vérifier avant de pousser

```sh
# API
cd services/api && go vet ./... && go test ./...

# App
cd apps/mobile && npm run typecheck && npm run lint && npm test

# Manifestes
kustomize build deploy/overlays/homelab > /dev/null
```

## Signaler un problème

Onglet Issues : modèle « Bug » ou « Tâche ». Une issue par problème, avec de quoi le reproduire.
