# 0011. Android Auto en catégories parking et recharge

Statut : Acceptée
Date : 2026-10-28

## Contexte

Zelo sert surtout en voiture, là où le téléphone ne doit pas être manipulé. Android Auto n'affiche que des apps construites avec ses gabarits, réparties en catégories (navigation, parking, recharge, points d'intérêt…) avec chacune ses règles.

## Décision

- Un module natif Kotlin (`apps/mobile/modules/zelo-auto`), en catégories **parking** et **recharge** : la liste des lieux les plus proches, posés sur la carte que dessine Android Auto, puis la fiche du lieu.
- **« Y aller » confie le guidage à l'app de navigation de la voiture** (intent `ACTION_NAVIGATE`). Être une app de navigation obligerait à dessiner notre propre carte sur la surface de la voiture et à passer la revue de la catégorie navigation, la plus stricte. Le guidage de Zelo reste sur le téléphone.
- L'écran de la voiture appelle l'API Zelo directement. Il ne dépend pas de React Native : l'app lui transmet seulement l'adresse de l'API.

## Conséquences

- Zelo est utilisable au volant pour ce qu'il fait de mieux : choisir où se garer ou recharger, avec le prix.
- CarPlay demandera un travail équivalent en Swift (catégories parking et recharge aussi), avec un droit à demander à Apple.
- Le module n'est testable qu'en voiture ou avec l'unité de test d'Android Auto sur PC.
