// Où se garer pour une destination (maquette 03b) : sans dépendance, testé avec `npm test`.
import { distance, type LatLon } from './geo.ts';

type Parking = LatLon & { id: string; name: string; fee: boolean | null };
type Charge = LatLon & { id: string; name: string; maxPowerKw: number; available: number | null };
/** Parking relais et ses trajets en tram ou bus (voir l'API /v1/park-ride). */
type Relay<P> = { parking: P; journeys: readonly { finalWalk: number }[] };

export type Target<P extends Parking = Parking, C extends Charge = Charge, R extends Relay<P> = Relay<P>> =
  | { kind: 'parking'; item: P; walk: number }
  | { kind: 'charge'; item: C; walk: number }
  /** Se garer au parking relais (`item`), le tram ou le bus, puis `walk` mètres depuis le dernier arrêt. */
  | { kind: 'parkride'; item: P; walk: number; relay: R }
  | { kind: 'dropoff' };

/** Au-delà, se garer là pour cette destination n'a plus de sens. */
const MAX_WALK_PARKING = 800;
const MAX_WALK_CHARGE = 500;

/**
 * Choix proposés à l'arrivée : les deux parkings les plus proches, le meilleur parking relais
 * (l'API les classe par heure d'arrivée), la borne libre la plus proche, puis « Me déposer à
 * l'entrée ». Le premier est le choix par défaut.
 */
export function targets<P extends Parking, C extends Charge, R extends Relay<P>>(
  dest: LatLon,
  parkings: readonly P[],
  charge: readonly C[],
  relays: readonly R[] = [],
) {
  const byWalk = <T extends LatLon>(list: readonly T[], max: number) =>
    list
      .map((item) => ({ item, walk: distance(dest, item) }))
      .filter((x) => x.walk <= max)
      .sort((a, b) => a.walk - b.walk);

  const out: Target<P, C, R>[] = byWalk(parkings, MAX_WALK_PARKING)
    .slice(0, 2)
    .map((x) => ({ kind: 'parking', ...x }));
  const relay = relays[0];
  if (relay?.journeys[0]) out.push({ kind: 'parkride', item: relay.parking, walk: relay.journeys[0].finalWalk, relay });
  const borne = byWalk(
    charge.filter((c) => (c.available ?? 0) > 0),
    MAX_WALK_CHARGE,
  )[0];
  if (borne) out.push({ kind: 'charge', ...borne });
  out.push({ kind: 'dropoff' });
  return out;
}

/** En dessous (m), l'arrêt est la destination : pas de trajet à pied. */
const MIN_WALK = 30;

/** Faut-il finir à pied après s'être arrêté ? */
export const needsWalk = (t: Target) => t.kind !== 'dropoff' && t.walk >= MIN_WALK;

/** Point où la voiture s'arrête. */
export const targetPoint = (t: Target, dest: LatLon): LatLon => (t.kind === 'dropoff' ? dest : t.item);

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'dropoff' || (b.kind !== 'dropoff' && a.item.id === b.item.id));
