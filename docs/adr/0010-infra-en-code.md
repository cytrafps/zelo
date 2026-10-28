# 0010. Infrastructure du homelab décrite en code (Terraform + Ansible)

Statut : Acceptée
Date : 2026-10-28

## Contexte

Le cluster K3s se montait à la main (commandes du README de `deploy/`). Une VM perdue ou un réglage oublié ne se retrouvaient qu'en mémoire. Le projet doit pouvoir se reconstruire à l'identique, et chaque changement d'infrastructure passer par une PR relue comme le code.

## Décision

- **Terraform (fournisseur `bpg/proxmox`)** crée la VM par l'API Proxmox : image cloud Debian 13 importée sans accès SSH au nœud, cloud-init (IP fixe, utilisateur `zelo`, clé SSH). Il écrit l'inventaire Ansible.
- **Ansible** installe la VM en quatre rôles rejouables : `base` (mises à jour, correctifs automatiques, SSH par clé seule), `k3s`, `argocd`, `zelo` (secret de la base créé une fois, applications Argo CD de `deploy/argocd`). Versions de K3s et d'Argo CD figées dans `group_vars`.
- Au-delà, **Argo CD** reste seul maître du contenu du cluster (ADR 0004) : Ansible ne déploie pas l'application, il l'enregistre.
- La CI valide Terraform (`fmt`, `validate`) et Ansible (syntaxe, `ansible-lint` profil production) à chaque PR.

## Conséquences

- Le cluster se reconstruit de zéro en deux commandes, environ 15 minutes.
- L'état Terraform reste local au PC (il contient le jeton Proxmox) : un backend partagé sera nécessaire si l'équipe administre le homelab à plusieurs.
- Une seule VM : pas de haute disponibilité des nœuds, assumé pour un homelab mono-machine.
