# Zelo · tableau de bord ville

Page web pour les services du Grand Reims : stationnement, recharge, carburant, signalements, API ouverte. Maquettes : Figma, page « 09 · Web — Tableau de bord ville ».

React + Vite, carte MapLibre GL JS avec le même style que l'app (`src/map/style.ts`, copie de `apps/mobile/src/screens/map/map-style.ts` : modifier les deux ensemble). Les données viennent de l'API Zelo sous `/v1`, à la même origine.

```sh
npm install
npm run dev                                   # http://localhost:5173, API sur localhost:8080
ZELO_API=http://192.168.1.88:8080 npm run dev # API d'une autre machine (la VM)
npm test && npm run build
```

En production, `Dockerfile` sert `dist/` avec nginx (sans root, port 8080) ; en Docker Compose, nginx relaie `/v1` vers l'API, sur Kubernetes c'est l'Ingress `web`.

## Données absentes

Aucune occupation de parking n'est publiée en temps réel à Reims. Les vignettes concernées l'indiquent au lieu d'afficher un chiffre ; elles se branchent quand Champagne Parc Auto ou le Grand Reims ouvrent leurs comptages. Aucun trajet n'est enregistré : le tableau de bord ne montre que des données agrégées.
