// Client de l'API Zelo (services/api). Les formes suivent services/api/internal/store.
import { deviceId } from '@/utils/device';
import { fetchWithin } from '@/utils/net';
import type { Route } from '@/utils/route';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const LIVE_URL = API_URL.replace(/^http/, 'ws') + '/v1/live';

export type BBox = [west: number, south: number, east: number, north: number];

export type FuelStation = {
  id: string;
  lat: number;
  lon: number;
  address: string;
  city: string;
  prices: Record<string, number>;
  updatedAt: string;
};

export type ChargeStation = {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
  maxPowerKw: number;
  sockets: string[];
  total: number;
  /** null : aucun état publié depuis 24 h. */
  available: number | null;
  observedAt: string | null;
  /** Prix annoncé par l'opérateur ; null s'il ne le publie pas lisiblement. */
  price: { free: boolean; kwh: number; from: boolean } | null;
};

export type Parking = {
  id: string;
  name: string;
  operator: string;
  kind: 'surface' | 'multi-storey' | 'underground' | 'street';
  lat: number;
  lon: number;
  capacity: number | null;
  disabled: number | null;
  charging: number | null;
  /** null : non renseigné dans OpenStreetMap. */
  fee: boolean | null;
  /** Hauteur maximale en mètres. */
  maxHeight: number | null;
  openingHours: string;
  parkRide: boolean;
  /** Tarifs relevés sur le site de l'exploitant ; null si non relevés. */
  tariff: Tariff | null;
};

export type Tariff = {
  /** Minutes offertes. */
  free: number;
  /** Prix (centimes) pour 1 h, 3 h, 24 h. */
  prices: { minutes: number; cents: number }[];
  source: string;
  /** Date du relevé (AAAA-MM-JJ). */
  checked: string;
};

export const REPORT_KINDS = [
  'accident',
  'bouchon',
  'travaux',
  'obstacle',
  'route_fermee',
  'place_liberee',
  'borne_hs',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export type Report = {
  id: number;
  kind: ReportKind;
  lat: number;
  lon: number;
  createdAt: string;
  expiresAt: string;
  /** Votes « toujours là » (le signalement initial n'en fait pas partie). */
  confirmations: number;
  denials: number;
};

/** « report » : nouveau ou mis à jour (votes) ; « report_removed » : retiré après des « plus là ». */
export type LiveEvent =
  | { type: 'report'; report: Report }
  | { type: 'report_removed'; id: number }
  /** Battement du serveur toutes les 25 s : prouve que la connexion vit. */
  | { type: 'hb' }
  /** Le serveur a pu perdre des événements (base reconnectée) : recharger les signalements. */
  | { type: 'resync' };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Zelo-Device': deviceId() };
  return fetchWithin(API_URL + path, { ...init, headers }, async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    return body as T;
  });
}

const list = <T>(path: string, bbox: BBox, signal?: AbortSignal) =>
  request<{ items: T[] }>(`${path}?bbox=${bbox.join(',')}`, { signal }).then((r) => r.items);

export const getFuelStations = (b: BBox, s?: AbortSignal) => list<FuelStation>('/v1/fuel-stations', b, s);
export const getChargeStations = (b: BBox, s?: AbortSignal) => list<ChargeStation>('/v1/charge-stations', b, s);
export const getParkings = (b: BBox, s?: AbortSignal) => list<Parking>('/v1/parkings', b, s);
export const getReports = (b: BBox, s?: AbortSignal) => list<Report>('/v1/reports', b, s);

/** Un signalement du même type à moins de 150 m n'est pas dupliqué : il est confirmé et renvoyé. */
export const postReport = (kind: ReportKind, lat: number, lon: number) =>
  request<Report>('/v1/reports', { method: 'POST', body: JSON.stringify({ kind, lat, lon }) });

/** « Toujours là » (up) ou « Plus là ». 409 : c'est ton propre signalement. */
export const voteReport = (id: number, up: boolean) =>
  request<{ report: Report; removed: boolean }>(`/v1/reports/${id}/votes`, { method: 'POST', body: JSON.stringify({ up }) });

export type Avoid = 'tolls' | 'highways';

/** Véhicule du trajet : à vélo, ni péage ni autoroute, et on s'arrête à la destination. */
export type Vehicle = 'car' | 'moto' | 'bike';

export type RouteOptions = {
  alternates?: number;
  /** Cap au départ (°) : évite de faire partir à contresens une voiture qui roule. */
  heading?: number | null;
  /** Heure de départ (ms) ; absente : maintenant. */
  depart?: number | null;
  avoid?: readonly Avoid[];
};

/** Itinéraires (Valhalla), du plus rapide au plus lent. 422 : point hors de la zone couverte. */
export function getRoutes(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  mode: Vehicle | 'walk',
  opts: RouteOptions = {},
  signal?: AbortSignal,
) {
  const q = [`from=${from.lat},${from.lon}`, `to=${to.lat},${to.lon}`, `mode=${mode}`, `alternates=${opts.alternates ?? 0}`];
  if (opts.heading != null) q.push(`heading=${Math.round(opts.heading) % 360}`);
  if (opts.depart != null) q.push(`depart=${Math.floor(opts.depart / 1000)}`);
  if (opts.avoid?.length) q.push(`avoid=${opts.avoid.join(',')}`);
  return request<{ routes: Route[] }>(`/v1/route?${q.join('&')}`, { signal }).then((r) => r.routes);
}
