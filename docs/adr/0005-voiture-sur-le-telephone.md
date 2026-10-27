# 0005. Position de la voiture gardée sur le téléphone

Statut : Acceptée
Date : 2026-10-26 (PR #5)

## Contexte

Savoir où est garée la voiture d'une personne est une donnée personnelle sensible. Le RGPD impose de ne collecter que le nécessaire.

## Décision

La position de la voiture est stockée uniquement sur le téléphone (expo-sqlite), jamais envoyée au serveur. Le géocodage passe par la Géoplateforme de l'IGN (l'API Adresse de data.gouv.fr lui a été transférée).

## Conséquences

Rien à protéger côté serveur pour cette donnée ; en contrepartie, pas de synchronisation entre appareils.
