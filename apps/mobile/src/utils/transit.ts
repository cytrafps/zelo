// Parking relais + tram ou bus : quel trajet prendre, et à quelle heure on arrive (testé avec `npm test`).
import type { Journey, TransitLeg } from '../api/zelo.ts';

/** m/s à pied, détours compris (comme l'API). */
export const WALK_SPEED = 1.2;

/** Premier trajet qu'on peut prendre en partant du parking relais à `parked` (ms). */
export const nextJourney = (journeys: readonly Journey[], parked: number) =>
  journeys.find((j) => Date.parse(j.legs[0].depart) >= parked + (j.boardWalk / WALK_SPEED) * 1000);

/** Tronçons en véhicule (sans les correspondances à pied). */
export const rides = (j: Journey) => j.legs.filter((l): l is TransitLeg & { line: NonNullable<TransitLeg['line']> } => !!l.line);

/**
 * Durée (s) entre l'arrivée au parking relais (`parked`, ms) et l'arrivée à destination : marche
 * jusqu'au quai, attente, trajets, puis `finalWalkSeconds` de marche. null : plus rien dans la fenêtre.
 */
export function relayDuration(journeys: readonly Journey[], parked: number, finalWalkSeconds: number) {
  const j = nextJourney(journeys, parked);
  if (!j) return null;
  return (Date.parse(j.legs.at(-1)!.arrive) - parked) / 1000 + finalWalkSeconds;
}

/** « Tram », « Bus 4 », « Tram puis bus O2 ». */
export function linesLabel(j: Journey) {
  const names = rides(j).map((l) => (l.line.mode === 'tram' ? 'tram' : `bus ${l.line.name}`));
  const label = names.join(' puis ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Nom d'arrêt affichable. L'API reprend le nom accentué d'OSM quand elle le trouve
 * (« Opéra-Cathédrale ») ; sinon le nom Citura, en capitales, est mis en minuscules.
 */
export const stopName = (s: string) => (s === s.toUpperCase() ? titleCase(s) : s);

/** « OPERA-CATHEDRALE » (le GTFS Citura est en capitales) devient « Opera-Cathedrale ». */
export function titleCase(s: string) {
  const title = s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
  return title.replace(/\b(Tgv|Chu|Sncf)\b/g, (w) => w.toUpperCase());
}
