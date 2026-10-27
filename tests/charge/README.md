# Test de charge

`zelo.js` (k6) simule trois usages en même temps :

| Scénario | Ce que fait chaque utilisateur virtuel |
|---|---|
| `carte` | Déplace la carte toutes les 3 à 6 s : 4 requêtes en parallèle (carburant, bornes, parkings, signalements) sur une vue de 4 × 3 km du Grand Reims. |
| `signalements` | Un signalement à débit constant, puis un vote sur la moitié d'entre eux. Chaque requête porte un appareil (`X-Zelo-Device`) et une IP (`CF-Connecting-IP`) différents. |
| `ecoute` | Garde le flux temps réel ouvert, se reconnecte toutes les 30 s et mesure le délai entre l'enregistrement d'un signalement et sa réception. |

Seuils : p99 < 500 ms sur les requêtes, p99 < 1 s pour le temps réel, moins de 1 % de réponses inattendues.

```sh
# API lancée avec TRUST_PROXY=true (sinon le quota par IP bride tout le test)
BASE_URL=http://localhost:8080 CONDUCTEURS=300 SIGNALEMENTS_PAR_S=10 ECOUTEURS=200 DUREE=2m k6 run tests/charge/zelo.js
```

## Résultats du 27 octobre 2026

Deux répliques de l'API derrière un répartiteur (Caddy, contrôle `/livez` chaque seconde, 2 nouvelles tentatives), une base PostGIS avec les données réelles (9 821 stations). **Tout tourne sur la même machine de 2 vCPU et 7 Go**, injecteur k6 compris : ce sont des planchers, pas la capacité d'un serveur dédié.

| Charge | Débit | p50 | p99 carte | p99 signalement | Temps réel p99 | Erreurs |
|---|---|---|---|---|---|---|
| 200 conducteurs, 10 signalements/s, 100 flux | 154 req/s | 6 ms | 29 ms | 38 ms | 36 ms | 0 |
| 450 conducteurs, 10 signalements/s, 200 flux | 331 req/s | 8 ms | 134 ms | 135 ms | 118 ms | 0 |
| 600 conducteurs, 10 signalements/s, 200 flux | 421 req/s | 30 ms | 1,04 s | 1,1 s | 332 ms | 0 |

La machine sature entre 330 et 420 req/s (CPU partagé entre k6, le répartiteur, les deux API et PostgreSQL). Au-delà, les temps montent mais aucune requête n'échoue.

### Bascule : une réplique tuée en pleine charge

300 conducteurs, 10 signalements/s, 200 flux temps réel. À t = 60 s, `kill -9` sur une des deux API, relancée 30 s plus tard.

- **0 erreur sur 32 649 requêtes** : le répartiteur rejoue sur la réplique restante les requêtes interrompues.
- p99 de 84 ms sur toute la durée, bascule comprise.
- **100 flux temps réel coupés sur 200**, tous à la seconde du `kill` : ceux qui étaient ouverts sur la réplique tuée. L'app se reconnecte en 0,5 à 1 s puis recharge les signalements de la vue, rien n'est perdu.
- La réplique relancée reprend sa part sans intervention.

En Kubernetes, la même bascule se reproduit avec `kubectl -n zelo delete pod <pod-api> --grace-period=0 --force` pendant le test.

### Défaut trouvé

Deux répliques qui démarraient en même temps se bloquaient sur la création du schéma (`deadlock detected`) : l'une plantait et ne repartait qu'au redémarrage suivant. L'application du schéma est maintenant sérialisée par un verrou PostgreSQL (`TestConcurrentStartup`).
