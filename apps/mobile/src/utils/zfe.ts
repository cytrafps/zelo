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

/** Jour local (AAAA-MM-JJ) d'un instant. */
export const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
