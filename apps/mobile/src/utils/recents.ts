// Destinations récentes : sans dépendance, testé avec `npm test`.

export const MAX_RECENTS = 6;

/** Ajoute `place` en tête, sans doublon, en gardant les `max` plus récentes. */
export function pushRecent<T extends { id: string }>(list: readonly T[], place: T, max = MAX_RECENTS): T[] {
  return [place, ...list.filter((p) => p.id !== place.id)].slice(0, max);
}
