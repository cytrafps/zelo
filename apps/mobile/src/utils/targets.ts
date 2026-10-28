// Où se garer pour une destination (maquette 03b) : sans dépendance, testé avec `npm test`.
import { distance, type LatLon } from './geo.ts';

type Parking = LatLon & { id: string; name: string; fee: boolean | null };
type Charge = LatLon & { id: string; name: string; maxPowerKw: number; available: number | null };

export type Target<P extends Parking = Parking, C extends Charge = Charge> =
  | { kind: 'parking'; item: P; walk: number }
  | { kind: 'charge'; item: C; walk: number }
  | { kind: 'dropoff' };

/** Au-delà, se garer là pour cette destination n'a plus de sens. */
const MAX_WALK_PARKING = 800;
const MAX_WALK_CHARGE = 500;

/**
 * Choix proposés à l'arrivée : les deux parkings les plus proches, la borne libre la plus proche,
 * puis « Me déposer à l'entrée ». Le premier est le choix par défaut.
 */
export function targets<P extends Parking, C extends Charge>(dest: LatLon, parkings: readonly P[], charge: readonly C[]) {
  const byWalk = <T extends LatLon>(list: readonly T[], max: number) =>
    list
      .map((item) => ({ item, walk: distance(dest, item) }))
      .filter((x) => x.walk <= max)
      .sort((a, b) => a.walk - b.walk);

  const out: Target<P, C>[] = byWalk(parkings, MAX_WALK_PARKING)
    .slice(0, 2)
    .map((x) => ({ kind: 'parking', ...x }));
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
