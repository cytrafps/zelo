# 0007. Signalements fiables sans compte utilisateur

Statut : Acceptée
Date : 2026-10-26 (PR #7)

## Contexte

Un signalement faux ou périmé dégrade la confiance dans la carte. Un compte utilisateur freinerait l'usage et ferait collecter des données personnelles.

## Décision

Votes « Toujours là / Plus là », doublons à moins de 150 m fusionnés en confirmation, retrait après 2 infirmations majoritaires. L'appareil est identifié par un identifiant aléatoire (`X-Zelo-Device`) dont seule une empreinte SHA-256 est gardée.

## Conséquences

Pas de compte, pas de donnée personnelle. Un utilisateur qui réinstalle l'app peut voter à nouveau : le quota par IP limite l'abus.
