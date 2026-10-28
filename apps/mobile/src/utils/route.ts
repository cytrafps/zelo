// Calculs de guidage sur un itinéraire Valhalla : sans dépendance, testés avec `npm test`.
import type { LatLon } from './geo.ts';

export type Step = {
  instruction: string;
  street?: string;
  /** Type de manœuvre Valhalla (virage, rond-point, arrivée…). */
  type: number;
  distance: number;
  duration: number;
  /** Index du premier point de la manœuvre dans `coordinates`. */
  shape: number;
  /** Voies à l'approche, de gauche à droite ; absentes si toutes conviennent ou si la route ne les décrit pas. */
  lanes?: Lane[];
  /** La manœuvre se fait à un feu ou à un stop (OpenStreetMap). */
  control?: 'feu' | 'stop';
};

export type Lane = {
  /** Flèches au sol : « left », « straight », « slight right »… */
  directions: string[];
  /** Voie qui mène à la manœuvre. */
  take: boolean;
};

export type Route = {
  distance: number;
  duration: number;
  /** [lon, lat] */
  coordinates: [number, number][];
  steps: Step[];
  /** Aires d'autoroute desservies (en voiture), dans l'ordre de passage. */
  areas?: Area[];
};

export type AreaService = 'restauration' | 'boutique' | 'toilettes' | 'douches' | 'camping-car' | 'pique-nique' | 'jeux';

export type Area = {
  id: string;
  /** « services » : aire de service ; « rest_area » : aire de repos. */
  kind: 'services' | 'rest_area';
  name: string;
  lat: number;
  lon: number;
  services: AreaService[];
  /** Prix le plus bas de chaque carburant à l'aire (€/L). */
  fuel?: Record<string, number>;
  /** Points de recharge ; `available` null sans état publié. */
  charge?: { total: number; available: number | null };
  /** Mètres depuis le départ. */
  along: number;
};

const M_PER_DEG = 111_320;

/** Projection locale en mètres autour d'une latitude : exacte à quelques mètres près sur une ville. */
function toXY(lon: number, lat: number, cosLat: number) {
  return { x: lon * M_PER_DEG * cosLat, y: lat * M_PER_DEG };
}

/** Distance cumulée (m) depuis le départ, pour chaque point du tracé. */
export function cumulative(coords: readonly [number, number][]) {
  const out = new Array<number>(coords.length).fill(0);
  if (coords.length === 0) return out;
  const cos = Math.cos((coords[0][1] * Math.PI) / 180);
  for (let i = 1; i < coords.length; i++) {
    const a = toXY(coords[i - 1][0], coords[i - 1][1], cos);
    const b = toXY(coords[i][0], coords[i][1], cos);
    out[i] = out[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  return out;
}

export type Snap = {
  /** Index du point qui ouvre le segment le plus proche. */
  segment: number;
  /** Écart au tracé, en mètres. */
  offRoute: number;
  /** Distance parcourue le long du tracé, en mètres. */
  along: number;
};

/** Point du tracé le plus proche de `p`, parmi les segments `from` à `to` (exclu) ; tout le tracé par défaut. */
export function snap(
  coords: readonly [number, number][],
  cum: readonly number[],
  p: LatLon,
  from = 0,
  to = coords.length - 1,
): Snap {
  const cos = Math.cos((p.lat * Math.PI) / 180);
  const P = toXY(p.lon, p.lat, cos);
  let best: Snap = { segment: 0, offRoute: Infinity, along: 0 };
  for (let i = Math.max(0, from); i < Math.min(to, coords.length - 1); i++) {
    const A = toXY(coords[i][0], coords[i][1], cos);
    const B = toXY(coords[i + 1][0], coords[i + 1][1], cos);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const d = Math.hypot(A.x + t * dx - P.x, A.y + t * dy - P.y);
    if (d < best.offRoute) best = { segment: i, offRoute: d, along: cum[i] + t * Math.sqrt(len2) };
  }
  if (coords.length === 1) {
    const A = toXY(coords[0][0], coords[0][1], cos);
    best = { segment: 0, offRoute: Math.hypot(A.x - P.x, A.y - P.y), along: 0 };
  }
  return best;
}

export type Progress = {
  /** Mètres restants jusqu'à l'arrivée. */
  remaining: number;
  /** Secondes restantes, au prorata du temps prévu par Valhalla. */
  remainingTime: number;
  /** Index dans `steps` de la prochaine manœuvre (la dernière : l'arrivée). */
  next: number;
  /** Mètres jusqu'à cette manœuvre. */
  toNext: number;
  offRoute: number;
  /** Segment où l'on se trouve : à repasser au calcul suivant (`hint`). */
  segment: number;
};

/** Fenêtre de recherche après la dernière position : de quoi couvrir quelques secondes de route. */
const BEHIND_M = 50;
const AHEAD_M = 600;
/** Plus loin que ça de la fenêtre, on cherche sur tout le tracé (raccourci, saut GPS…). */
const WINDOW_MAX_OFF_M = 30;

/** Segments à moins de `behind` m en arrière et `ahead` m en avant du segment `at`. */
function window(cum: readonly number[], at: number, behind: number, ahead: number): [number, number] {
  let from = at;
  while (from > 0 && cum[at] - cum[from] < behind) from--;
  let to = at + 1;
  while (to < cum.length - 1 && cum[to] - cum[at] < ahead) to++;
  return [from, to];
}

/**
 * Avancement sur l'itinéraire. Avec `hint` (le segment du calcul précédent), la position est
 * cherchée d'abord juste devant : un tracé qui repasse par la même rue (aller-retour, boucle)
 * ne fait pas sauter le guidage à l'autre passage.
 */
export function progress(route: Route, cum: readonly number[], p: LatLon, hint?: number): Progress {
  let s: Snap | null = null;
  if (hint !== undefined) {
    const near = snap(route.coordinates, cum, p, ...window(cum, hint, BEHIND_M, AHEAD_M));
    if (near.offRoute <= WINDOW_MAX_OFF_M) s = near;
  }
  s ??= snap(route.coordinates, cum, p);
  const total = cum[cum.length - 1] ?? 0;
  const remaining = Math.max(0, total - s.along);
  let next = route.steps.findIndex((st) => st.shape > s.segment);
  if (next === -1) next = route.steps.length - 1;
  const toNext = Math.max(0, (cum[route.steps[next]?.shape ?? cum.length - 1] ?? total) - s.along);
  const remainingTime = total > 0 ? route.duration * (remaining / total) : 0;
  return { remaining, remainingTime, next, toNext, offRoute: s.offRoute, segment: s.segment };
}

/**
 * Éléments à moins de `maxMeters` du tracé, avec la rue de la manœuvre la plus proche
 * (« Accident · bd Lundy »).
 */
export function along<T extends LatLon>(route: Route, cum: readonly number[], items: readonly T[], maxMeters = 50) {
  return items.flatMap((item) => {
    const s = snap(route.coordinates, cum, item);
    if (s.offRoute > maxMeters) return [];
    const step = [...route.steps].reverse().find((st) => st.shape <= s.segment);
    return [{ item, along: s.along, street: step?.street }];
  });
}

/** « 4 min », « 1 h 05 ». Arrondi à la minute supérieure : on n'annonce jamais moins que la réalité. */
export function formatDuration(seconds: number) {
  const min = Math.max(1, Math.ceil(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** « 20 h 08 ». */
export function formatClock(d: Date) {
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Emprise [ouest, sud, est, nord] d'un ou plusieurs tracés. */
export function bounds(...lines: (readonly [number, number][])[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of lines)
    for (const [lon, lat] of line) {
      w = Math.min(w, lon);
      s = Math.min(s, lat);
      e = Math.max(e, lon);
      n = Math.max(n, lat);
    }
  return [w, s, e, n];
}

/** Point situé à `ratio` de la longueur du tracé (pour poser la durée sur la carte). */
export function pointAt(coords: readonly [number, number][], cum: readonly number[], ratio: number): [number, number] {
  const target = (cum[cum.length - 1] ?? 0) * ratio;
  const i = Math.max(0, cum.findIndex((d) => d >= target));
  return coords[i] ?? coords[0];
}
