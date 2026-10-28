// Où se garer pour une destination (maquette 03b) : sans dépendance, testé avec `npm test`.
import { distance, type LatLon } from './geo.ts';

type TwoOrFour = 'car' | 'moto' | 'bike';
/** `vehicle` absent : parking voiture. */
type Parking = LatLon & { id: string; name: string; fee: boolean | null; vehicle?: TwoOrFour; kind?: string; covered?: boolean };
type Charge = LatLon & { id: string; name: string; maxPowerKw: number; available: number | null; twoWheels?: boolean };
/** Parking relais et ses trajets en tram ou bus (voir l'API /v1/park-ride). */
type Relay<P> = { parking: P; journeys: readonly { finalWalk: number }[] };

export type Target<P extends Parking = Parking, C extends Charge = Charge, R extends Relay<P> = Relay<P>> =
  | { kind: 'parking'; item: P; walk: number }
  | { kind: 'charge'; item: C; walk: number }
  /** Se garer au parking relais (`item`), le tram ou le bus, puis `walk` mètres depuis le dernier arrêt. */
  | { kind: 'parkride'; item: P; walk: number; relay: R }
  | { kind: 'dropoff' };

/** Au-delà, se garer là pour cette destination n'a plus de sens (à vélo, on s'arrête au pied). */
const MAX_WALK_PARKING = { car: 800, moto: 500, bike: 250 } as const;
const PARKINGS_SHOWN = { car: 2, moto: 1, bike: 2 } as const;
const MAX_WALK_CHARGE = 500;

/**
 * Choix proposés à l'arrivée, tous véhicules confondus (`forVehicle` trie ensuite) : les deux
 * parkings les plus proches, la place moto et les deux arceaux vélo les plus proches, le meilleur
 * parking relais (l'API les classe par heure d'arrivée), la borne libre la plus proche, puis
 * « Me déposer à l'entrée ».
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

  const out: Target<P, C, R>[] = (['car', 'moto', 'bike'] as const).flatMap((v) =>
    byWalk(
      parkings.filter((p) => (p.vehicle ?? 'car') === v),
      MAX_WALK_PARKING[v],
    )
      .slice(0, PARKINGS_SHOWN[v])
      .map((x) => ({ kind: 'parking' as const, ...x })),
  );
  const relay = relays[0];
  if (relay?.journeys[0]) out.push({ kind: 'parkride', item: relay.parking, walk: relay.journeys[0].finalWalk, relay });
  const borne = byWalk(
    charge.filter((c) => (c.available ?? 0) > 0),
    MAX_WALK_CHARGE,
  )[0];
  if (borne) out.push({ kind: 'charge', ...borne });
  // À moto, la borne la plus proche ne convient que si elle accepte les deux-roues.
  const deuxRoues = byWalk(
    charge.filter((c) => c.twoWheels && (c.available ?? 0) > 0),
    MAX_WALK_CHARGE,
  )[0];
  if (deuxRoues && deuxRoues.item !== borne?.item) out.push({ kind: 'charge', ...deuxRoues });
  out.push({ kind: 'dropoff' });
  return out;
}

/**
 * Les choix qui valent pour ce véhicule, le meilleur d'abord : à vélo, les arceaux ; à moto, les
 * places moto puis les parkings et les bornes deux-roues ; en voiture, parkings, relais et bornes.
 */
export function forVehicle<T extends Target>(options: readonly T[], vehicle: TwoOrFour): T[] {
  const kind = (t: T) => (t.kind === 'parking' || t.kind === 'parkride' ? (t.item.vehicle ?? 'car') : null);
  const ok = options.filter((t) => {
    if (t.kind === 'dropoff') return true;
    if (t.kind === 'charge') return vehicle === 'car' || (vehicle === 'moto' && !!t.item.twoWheels);
    if (t.kind === 'parkride') return vehicle !== 'bike';
    const v = kind(t);
    return vehicle === 'bike' ? v === 'bike' : vehicle === 'moto' ? v !== 'bike' : v === 'car';
  });
  return vehicle === 'moto' ? [...ok.filter((t) => kind(t) === 'moto'), ...ok.filter((t) => kind(t) !== 'moto')] : ok;
}

/** En dessous (m), l'arrêt est la destination : pas de trajet à pied. */
const MIN_WALK = 30;

/** Faut-il finir à pied après s'être arrêté ? */
export const needsWalk = (t: Target) => t.kind !== 'dropoff' && t.walk >= MIN_WALK;

/** Point où la voiture s'arrête. */
export const targetPoint = (t: Target, dest: LatLon): LatLon => (t.kind === 'dropoff' ? dest : t.item);

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'dropoff' || (b.kind !== 'dropoff' && a.item.id === b.item.id));

/** À l'abri de la pluie et du gel : parking souterrain ou à étages, arceaux couverts. */
export const sheltered = (t: Target) =>
  (t.kind === 'parking' || t.kind === 'parkride') &&
  (t.item.kind === 'underground' || t.item.kind === 'multi-storey' || t.item.covered === true);
