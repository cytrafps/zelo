# 0008. Accès depuis Internet par Cloudflare Tunnel

Statut : Acceptée
Date : 2026-10-27 (PR #11)

## Contexte

Tester l'app en 4G et la montrer hors du réseau local, sans ouvrir de port sur la box ni gérer de certificat.

## Décision

`cloudflared` établit une connexion sortante vers Cloudflare : tunnel rapide sans compte pour les tests, tunnel nommé avec jeton pour une adresse fixe. Derrière le tunnel, l'API lit l'IP du client dans `CF-Connecting-IP` (`TRUST_PROXY=true`).

## Conséquences

Aucun port entrant. `TRUST_PROXY` ne doit être activé que derrière le tunnel : exposée en direct, l'API laisserait un client choisir son IP et contourner le quota.
