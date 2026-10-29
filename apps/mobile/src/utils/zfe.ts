// Zones à faibles émissions (voir l'API /v1/zfe) : sans dépendance, testé avec `npm test`.
import type { LatLon } from './geo.ts';

/** Vignettes, de la plus propre à la plus polluante (NC : sans vignette). */
export const CRITAIR = ['EL', 'V1', 'V2', 'V3', 'V4', 'V5', 'NC'] as const;
export type Critair = (typeof CRITAIR)[number];

export type ZoneRule = { banned: Critair; hours?: string };
export type Zone = {
  id: string;
  name: string;
  /** AAAA-MM-JJ, inclus. */
  from: string;
  to?: string;
  url?: string;
  car?: ZoneRule;
  moto?: ZoneRule;
  /** Multipolygone [lon, lat]. */
  polygons: [number, number][][][];
};

/** Intérieur d'un anneau (lancer de rayon). */
function inRing(ring: readonly [number, number][], p: LatLon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Dans le polygone : dans l'anneau extérieur, hors des trous. */
const inPolygon = (poly: readonly [number, number][][], p: LatLon) =>
  poly.length > 0 && inRing(poly[0], p) && !poly.slice(1).some((hole) => inRing(hole, p));

/** La zone en vigueur ce jour-là (AAAA-MM-JJ) qui contient le point, la plus récente d'abord. */
export function zoneAt(zones: readonly Zone[], p: LatLon, day: string) {
  return zones
    .filter((z) => z.from <= day && (!z.to || z.to >= day) && z.polygons.some((poly) => inPolygon(poly, p)))
    .sort((a, b) => b.from.localeCompare(a.from))[0];
}

/** La vignette est-elle refusée par la règle ? (« V4 » refuse Crit'Air 4, 5 et sans vignette.) */
export const refused = (vignette: Critair, rule: ZoneRule) => CRITAIR.indexOf(vignette) >= CRITAIR.indexOf(rule.banned);

/** Libellé d'une vignette : « Crit'Air 3 », « électrique », « sans vignette ». */
export const critairLabel = (v: Critair) => (v === 'EL' ? 'électrique' : v === 'NC' ? 'sans vignette' : `Crit'Air ${v.slice(1)}`);

/**
 * Heure de Paris d'un instant, quel que soit le fuseau du téléphone : heure d'été du dernier
 * dimanche de mars au dernier dimanche d'octobre, à 1 h UTC (règle européenne).
 */
export function paris(ms: number) {
  const year = new Date(ms).getUTCFullYear();
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(year, month + 1, 0, 1)); // dernier jour du mois, 1 h UTC
    return d.getTime() - d.getUTCDay() * 86_400_000;
  };
  const summer = ms >= lastSunday(2) && ms < lastSunday(9);
  const d = new Date(ms + (summer ? 2 : 1) * 3_600_000);
  return {
    day: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    weekday: d.getUTCDay(), // 0 : dimanche
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * La règle s'applique-t-elle à cet instant ? `hours` suit opening_hours d'OSM : « 24/7 »,
 * « Mo-Fr 07:00-20:00 », « Mo-Fr 07:00-20:00; Sa 08:00-12:00 ». null si le format n'est pas
 * compris : on ne devine pas, la règle est alors tenue pour permanente par l'appelant.
 */
export function ruleActive(hours: string | undefined, ms: number): boolean | null {
  if (!hours || hours.trim() === '24/7') return true;
  const { weekday, minutes } = paris(ms);
  let active = false;
  for (const part of hours.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(?:([A-Za-z,\- ]+?)\s+)?((?:\d{2}:\d{2}-\d{2}:\d{2})(?:\s*,\s*\d{2}:\d{2}-\d{2}:\d{2})*)$/.exec(part);
    if (!m) return null;
    let days = new Set(DAYS.map((_, i) => i));
    if (m[1]) {
      days = new Set();
      for (const spec of m[1].split(',').map((x) => x.trim())) {
        const [a, b] = spec.split('-').map((x) => DAYS.indexOf(x.trim()));
        if (a < 0 || (b !== undefined && b < 0)) return null;
        for (let i = a; ; i = (i + 1) % 7) {
          days.add(i);
          if (b === undefined || i === b) break;
        }
      }
    }
    const today = days.has(weekday);
    const yesterday = days.has((weekday + 6) % 7);
    for (const range of m[2].split(',')) {
      const [from, to] = range.trim().split('-').map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
      // Une plage qui passe minuit (« 22:00-06:00 ») a commencé ce jour-là ou la veille.
      const inside = to > from ? today && minutes >= from && minutes < to : (today && minutes >= from) || (yesterday && minutes < to);
      if (inside) active = true;
    }
  }
  return active;
}

/**
 * La première zone (en vigueur ce jour-là) où passe le tracé, s'il y passe. Les points de Valhalla
 * sont rapprochés en ville : tester les sommets suffit.
 */
export function zoneCrossed(zones: readonly Zone[], line: readonly [number, number][], day: string) {
  for (const [lon, lat] of line) {
    const z = zoneAt(zones, { lat, lon }, day);
    if (z) return z;
  }
  return undefined;
}
