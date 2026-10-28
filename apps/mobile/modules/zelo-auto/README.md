# Zelo sur Android Auto

Module natif (Kotlin, [Android for Cars App Library](https://developer.android.com/training/cars/apps)) qui affiche Zelo sur l'écran de la voiture. Voir l'[ADR 0011](../../../../docs/adr/0011-android-auto-parking-recharge.md).

- **Parkings** : les plus proches de la voiture, sur la carte d'Android Auto, avec la distance et le prix d'une heure.
- **Recharge** : les bornes libres (ou sans état publié) les plus proches, avec la puissance.
- **Fiche** : tarifs, places, hauteur ; disponibilité, puissance, prix. « Y aller » passe le guidage à l'app de navigation de la voiture (Google Maps, Waze…).

- **Voiture garée, place libérée** : tant que l'app vit (ouverte, ou Zelo affiché dans la voiture), `CarWatch` suit la connexion à Android Auto. À la déconnexion, il note la dernière position connue du téléphone ; l'app l'enregistre comme emplacement de la voiture si elle est récente (moins de 3 min) et précise (moins de 50 m), sinon elle demande où l'on est garé. À la reconnexion, la place enregistrée est proposée au signalement « place libérée » pendant 20 min. Rien ne quitte le téléphone sans que l'utilisateur touche « Signaler ».

L'écran de la voiture tourne sans JavaScript : l'app lui transmet seulement l'adresse de l'API au démarrage (`setApiUrl`). La position vient du téléphone, avec l'autorisation déjà donnée à Zelo.

## Tester

Le module est natif : il faut un nouveau development build (`npm run dev` le refait seul).

**Dans une vraie voiture** :
1. Ouvre Zelo une fois sur le téléphone.
2. Dans les réglages d'Android Auto, touche 10 fois « Version » pour passer en mode développeur.
3. Dans le menu ⋮, choisis « Paramètres pour les développeurs », puis active « Sources inconnues ».
4. Branche le téléphone. Zelo apparaît dans le lanceur d'Android Auto.

**Sans voiture**, avec l'unité de test sur le PC (Desktop Head Unit, dans le SDK Android, *SDK Tools → Android Auto Desktop Head Unit Emulator*) :
1. Sur le téléphone, ouvre le menu ⋮ d'Android Auto et choisis « Démarrer le serveur de l'unité principale ».
2. Sur le PC, lance `adb forward tcp:5277 tcp:5277`, puis `desktop-head-unit` (dans `extras/google/auto`).

## Limites

- **Pas de guidage dans Zelo à l'écran de la voiture.** Une app de navigation doit dessiner sa propre carte et passer une revue Google plus stricte : le guidage reste celui de l'app de navigation de la voiture (ADR 0011).
- **Publication sur le Play Store** : Google relit les apps Android Auto avant publication, selon les règles de qualité des catégories parking et recharge.
