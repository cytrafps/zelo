# 0003. Aucun signalement de police ou de radar

Statut : Acceptée
Date : 2026-10-26

## Contexte

Le Code de la route (art. R413-15, décret 2012-3) interdit de signaler la position des forces de l'ordre et des radars aux conducteurs.

## Décision

Les types de signalement sont fermés côté API (`ReportTTL`) : accident, bouchon, travaux, obstacle, route fermée, place libérée, borne hors service. Aucun type « police » ni « radar ».

## Conséquences

Un type inconnu est refusé (HTTP 400). Ajouter un type passe par une PR sur l'API et l'app.
