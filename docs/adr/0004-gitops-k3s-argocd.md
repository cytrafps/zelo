# 0004. Déploiement K3s en GitOps avec Argo CD

Statut : Acceptée
Date : 2026-10-26 (PR #4)

## Contexte

Un déploiement reproductible sur le homelab, sans accès SSH depuis la CI, et un état du cluster lisible dans le dépôt.

## Décision

Manifestes Kustomize dans `deploy/`. La CI publie l'image sur GHCR puis écrit son tag dans `deploy/overlays/homelab` ; Argo CD synchronise le cluster depuis `main`. Supervision par kube-prometheus-stack, alertes testées par promtool à chaque PR.

## Conséquences

- `main` est toujours déployable : rien n'y arrive sans CI verte.
- Les commits `deploy: api sha-…` sont écrits par la CI, jamais à la main.
- NetworkPolicy, conteneurs non root, système de fichiers en lecture seule.
