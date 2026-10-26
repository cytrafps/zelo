// Calculs de distance : sans dépendance, testés avec `npm test`.

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau en mètres (formule de haversine). */
export function distance(a: LatLon, b: LatLon) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Les `limit` éléments les plus proches de `origin`, du plus proche au plus loin. */
export function nearest<T extends LatLon>(items: readonly T[], origin: LatLon, limit: number) {
  return items
    .map((item) => ({ item, meters: distance(origin, item) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** « 40 m », « 350 m », « 1,2 km », « 12 km ». */
export function formatDistance(meters: number) {
  if (meters < 995) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const k = meters / 1000;
  return `${k < 10 ? km.format(Math.round(k * 10) / 10) : Math.round(k)} km`;
}

/** Temps de marche arrondi (4,5 km/h, détours compris dans le facteur 1,3). */
export function walkingMinutes(meters: number) {
  return Math.max(1, Math.round((meters * 1.3) / 75));
}

/**
 * Reclasse des résultats de géocodage : pertinence du texte d'abord, proximité ensuite.
 * Le biais lat/lon de la Géoplateforme est faible : « 12 rue de Vesle » vu de Reims
 * renvoyait d'abord une homonyme à 39 km. Pénalité logarithmique : 1 km ou 3 km comptent peu,
 * 40 km ou 500 km beaucoup. Une commune n'est pas pénalisée : la taper, c'est vouloir y aller.
 */
export function rankByProximity<T extends LatLon & { score: number; municipality?: boolean }>(
  items: readonly T[],
  origin: LatLon,
  limit: number,
) {
  const adjusted = (x: T) => (x.municipality ? x.score : x.score - 0.15 * Math.log10(1 + distance(origin, x) / 1000));
  return [...items].sort((a, b) => adjusted(b) - adjusted(a)).slice(0, limit);
}
