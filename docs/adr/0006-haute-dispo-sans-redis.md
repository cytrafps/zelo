# 0006. Deux répliques, coordonnées par PostgreSQL, sans Redis

Statut : Acceptée
Date : 2026-10-26 (PR #6)

## Contexte

L'API doit survivre à la perte d'une instance. Deux besoins de coordination : diffuser chaque signalement aux clients de toutes les instances, et n'avoir qu'un seul collecteur de données ouvertes.

## Décision

- Diffusion par PostgreSQL `LISTEN/NOTIFY` (canal `zelo_live`).
- Collecteur unique élu par verrou consultatif (`pg_try_advisory_lock`).
- Application du schéma sérialisée par un second verrou au démarrage (PR #12).

## Conséquences

- Haute disponibilité sans composant de plus : 56 ms d'une réplique à l'autre, reprise des collectes en 5 s après un `kill -9`.
- Test de charge : 0 erreur sur 32 649 requêtes avec une réplique tuée en pleine charge ([résultats](../../tests/charge/README.md)).
- Limite : le quota par IP est compté par réplique.
