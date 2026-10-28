// Que faire d'un événement Android Auto (voir modules/zelo-auto) : sans dépendance, testé avec `npm test`.
import type { LatLon } from './geo.ts';

type CarEvent =
  | { kind: 'parked'; at: number; lat?: number; lon?: number; accuracy?: number; fixAt?: number }
  | { kind: 'departed'; at: number };

/** Au-delà, la position notée ne désigne pas la place à coup sûr : on demande. */
const MAX_ACCURACY_M = 50;
/** Position plus ancienne que ça au moment de la déconnexion : la voiture a pu rouler depuis. */
const MAX_FIX_AGE_MS = 3 * 60_000;

export type CarAction =
  /** Enregistrer la voiture ici. */
  | { kind: 'park'; at: LatLon }
  /** Déconnecté sans position fiable : demander où elle est garée. */
  | { kind: 'ask' }
  /** Reparti : la place (`at`) vient de se libérer. */
  | { kind: 'freed'; at: LatLon; since: number };

export function carAction(e: CarEvent, car: (LatLon & { parkedAt: string }) | null): CarAction | null {
  if (e.kind === 'departed') {
    if (!car || Date.parse(car.parkedAt) > e.at) return null;
    return { kind: 'freed', at: { lat: car.lat, lon: car.lon }, since: e.at };
  }
  const fresh = e.fixAt !== undefined && e.at - e.fixAt <= MAX_FIX_AGE_MS;
  if (e.lat === undefined || e.lon === undefined || !fresh || (e.accuracy ?? Infinity) > MAX_ACCURACY_M) return { kind: 'ask' };
  return { kind: 'park', at: { lat: e.lat, lon: e.lon } };
}

/** Une place libérée ne vaut d'être signalée que peu de temps : d'autres l'auront prise. */
export const FREED_FOR_MS = 20 * 60_000;
