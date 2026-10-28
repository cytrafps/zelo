// Parking relais + tram : quel tram prendre, et à quelle heure on arrive (testé avec `npm test`).
import type { Ride } from '../api/zelo.ts';

/** m/s à pied, détours compris (comme l'API). */
export const WALK_SPEED = 1.2;

/** Premier tram qu'on peut prendre en étant au quai à `ready` (ms). */
export const nextRide = (rides: readonly Ride[], ready: number) => rides.find((r) => Date.parse(r.depart) >= ready);

/**
 * Durée (s) entre l'arrivée au parking relais (`parked`, ms) et l'arrivée à destination :
 * marche jusqu'au quai, attente, tram, puis marche finale. null : plus de tram dans la fenêtre.
 */
export function relayDuration(rides: readonly Ride[], parked: number, boardWalk: number, finalWalkSeconds: number) {
  const ride = nextRide(rides, parked + (boardWalk / WALK_SPEED) * 1000);
  if (!ride) return null;
  return (Date.parse(ride.arrive) - parked) / 1000 + finalWalkSeconds;
}

/** « OPERA-CATHEDRALE » (le GTFS Citura est en capitales) devient « Opera-Cathedrale ». */
export function titleCase(s: string) {
  const title = s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
  return title.replace(/\b(Tgv|Chu|Sncf)\b/g, (w) => w.toUpperCase());
}
