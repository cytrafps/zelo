// Que faire des événements Android Auto ou Bluetooth (voir modules/zelo-auto) : sans dépendance, testé avec `npm test`.
import type { LatLon } from './geo.ts';

/** D'où vient l'événement : Android Auto ou le Bluetooth de la voiture. */
export type CarVia = 'auto' | 'bluetooth';

type CarEvent =
  | { kind: 'parked'; at: number; lat?: number; lon?: number; accuracy?: number; fixAt?: number; via?: CarVia }
  | { kind: 'departed'; at: number; via?: CarVia };

type Car = LatLon & { parkedAt: string };

/** Au-delà, la position notée ne désigne pas la place à coup sûr : on demande. */
const MAX_ACCURACY_M = 50;
/** Position plus ancienne que ça au moment de la déconnexion : la voiture a pu rouler depuis. */
const MAX_FIX_AGE_MS = 3 * 60_000;

export type CarAction =
  /** Enregistrer la voiture ici. */
  | { kind: 'park'; at: LatLon; via?: CarVia }
  /** Déconnecté sans position fiable : demander où elle est garée. */
  | { kind: 'ask'; via?: CarVia }
  /** Reparti : la place (`at`) vient de se libérer. */
  | { kind: 'freed'; at: LatLon; since: number };

export function carAction(e: CarEvent, car: Car | null): CarAction | null {
  if (e.kind === 'departed') {
    if (!car || Date.parse(car.parkedAt) > e.at) return null;
    return { kind: 'freed', at: { lat: car.lat, lon: car.lon }, since: e.at };
  }
  const via = e.via ? { via: e.via } : {};
  const fresh = e.fixAt !== undefined && e.at - e.fixAt <= MAX_FIX_AGE_MS;
  if (e.lat === undefined || e.lon === undefined || !fresh || (e.accuracy ?? Infinity) > MAX_ACCURACY_M) return { kind: 'ask', ...via };
  return { kind: 'park', at: { lat: e.lat, lon: e.lon }, ...via };
}

/**
 * Événements notés pendant que l'app était fermée, du plus ancien au plus récent : chacun est
 * jugé d'après la voiture laissée par le précédent. Garé en B puis reparti : c'est B qui se
 * libère, pas la place d'avant. Après une déconnexion sans position fiable, on ne sait plus où
 * est la voiture : un départ ensuite ne libère rien.
 */
export function carActions(events: readonly CarEvent[], car: Car | null): CarAction[] {
  let current = car;
  const out: CarAction[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const a = carAction(e, current);
    if (!a) continue;
    out.push(a);
    current = a.kind === 'park' ? { ...a.at, parkedAt: new Date(e.at).toISOString() } : null;
  }
  return out;
}

/** Une place libérée ne vaut d'être signalée que peu de temps : d'autres l'auront prise. */
export const FREED_FOR_MS = 20 * 60_000;
