import type { BBox } from '@/api/zelo';

/** L'API refuse les zones de plus de 1° de côté. */
export const MAX_SPAN = 1;

/**
 * Zone à charger pour la vue visible : agrandie de 50 % pour que les petits
 * déplacements ne déclenchent pas de requête, et arrondie au centième vers
 * l'extérieur pour que les réponses restent cachables (Cache-Control côté API).
 */
export function fetchArea([w, s, e, n]: BBox): BBox | null {
  const dx = (e - w) * 0.25;
  const dy = (n - s) * 0.25;
  const area: BBox = [
    Math.floor((w - dx) * 100) / 100,
    Math.floor((s - dy) * 100) / 100,
    Math.ceil((e + dx) * 100) / 100,
    Math.ceil((n + dy) * 100) / 100,
  ];
  if (area[2] - area[0] > MAX_SPAN || area[3] - area[1] > MAX_SPAN) return null;
  return area;
}

export function contains(outer: BBox, [w, s, e, n]: BBox) {
  return w >= outer[0] && s >= outer[1] && e <= outer[2] && n <= outer[3];
}
