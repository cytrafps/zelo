# Décisions d'architecture

Une décision structurante = un fichier court : le contexte, ce qui a été décidé, ce que ça implique.
Une décision n'est jamais réécrite : si elle change, une nouvelle la remplace et l'ancienne passe au statut « Remplacée par ».

| N° | Décision | Statut |
|---|---|---|
| [0001](0001-app-expo-maplibre.md) | App en Expo + MapLibre, en development build | Acceptée |
| [0002](0002-parkings-openstreetmap.md) | Parkings depuis OpenStreetMap, pas la base nationale | Acceptée |
| [0003](0003-pas-de-police-ni-radar.md) | Aucun signalement de police ou de radar | Acceptée |
| [0004](0004-gitops-k3s-argocd.md) | Déploiement K3s en GitOps avec Argo CD | Acceptée |
| [0005](0005-voiture-sur-le-telephone.md) | Position de la voiture gardée sur le téléphone | Acceptée |
| [0006](0006-haute-dispo-sans-redis.md) | Deux répliques, coordonnées par PostgreSQL, sans Redis | Acceptée |
| [0007](0007-signalements-sans-compte.md) | Signalements fiables sans compte utilisateur | Acceptée |
| [0008](0008-acces-par-cloudflare-tunnel.md) | Accès depuis Internet par Cloudflare Tunnel | Acceptée |
| [0009](0009-itineraires-valhalla.md) | Itinéraires calculés par Valhalla auto-hébergé | Acceptée |
| [0010](0010-infra-en-code.md) | Infrastructure du homelab décrite en code (Terraform + Ansible) | Acceptée |
| [0011](0011-android-auto-parking-recharge.md) | Android Auto en catégories parking et recharge | Acceptée |

Nouvelle décision : copier [le modèle](modele.md), prendre le numéro suivant, l'ajouter à ce tableau dans la même PR.
