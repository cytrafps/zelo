// File d'attente des signalements faits sans réseau (parking souterrain, zone blanche) : sans
// dépendance, testé avec `npm test`.

export type Pending<K extends string = string> = { kind: K; lat: number; lon: number; at: number; tries: number; nextAt: number };

/** Passé ce délai, un signalement ne décrit plus la route : on l'abandonne plutôt que de l'envoyer en retard. */
export const MAX_AGE_MS = 15 * 60_000;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 2 * 60_000;

export const enqueue = <K extends string>(queue: readonly Pending<K>[], p: { kind: K; lat: number; lon: number }, now: number) => [
  ...queue,
  { ...p, at: now, tries: 0, nextAt: now },
];

/** Signalements encore valables : à envoyer maintenant (`due`) et à garder (`keep`, rangés pour plus tard). */
export function split<K extends string>(queue: readonly Pending<K>[], now: number) {
  const fresh = queue.filter((p) => now - p.at < MAX_AGE_MS);
  return { due: fresh.filter((p) => p.nextAt <= now), keep: fresh.filter((p) => p.nextAt > now) };
}

/** Nouvel essai plus tard, de plus en plus espacé : 5 s, 10 s, 20 s… jusqu'à 2 min. */
export const retryLater = <K extends string>(p: Pending<K>, now: number): Pending<K> => ({
  ...p,
  tries: p.tries + 1,
  nextAt: now + Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** p.tries),
});

/** Prochain essai (ms), ou null si la file est vide. */
export const nextAttempt = (queue: readonly Pending[]) => (queue.length ? Math.min(...queue.map((p) => p.nextAt)) : null);
