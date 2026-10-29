// Client de l'API Zelo (services/api). Les formes suivent services/api/internal/store.
import { deviceId } from '@/utils/device';
import { fetchWithin } from '@/utils/net';
import type { LatLon } from '@/utils/geo';
import type { Route } from '@/utils/route';
import type { EvModel } from '@/utils/ev';
import type { Zone } from '@/utils/zfe';

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
  /** Tous les points en « accès réservé » (clients, flotte) : pas pour le public. */
  reserved: boolean;
  /** Accessible en fauteuil ; null : inconnu. */
  pmr: boolean | null;
  /** Hauteur maximale (m), null si non publiée. */
  maxHeight: number | null;
  /** Adaptée aux scooters et motos électriques. */
  twoWheels: boolean;
  placement: '' | 'voirie' | 'parking' | 'parking-clients' | 'recharge-rapide';
  bookable: boolean;
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
  /** car : parking ; moto : places deux-roues motorisés ; bike : arceaux vélo. */
  vehicle: Vehicle;
  /** Abrité (vélos, motos). */
  covered: boolean;
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
  // L'identifiant de l'appareil ne sert qu'aux signalements et aux votes : envoyé avec un
  // itinéraire ou une météo, il relierait départs et arrivées d'une même personne.
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (init.method === 'POST') headers['X-Zelo-Device'] = deviceId();
  return fetchWithin(API_URL + path, { ...init, headers }, async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    return body as T;
  });
}

const list = <T>(path: string, bbox: BBox, signal?: AbortSignal) =>
  request<{ items: T[] }>(`${path}${path.includes('?') ? '&' : '?'}bbox=${bbox.join(',')}`, { signal }).then((r) => r.items);

export const getFuelStations = (b: BBox, s?: AbortSignal) => list<FuelStation>('/v1/fuel-stations', b, s);
export const getChargeStations = (b: BBox, s?: AbortSignal) => list<ChargeStation>('/v1/charge-stations', b, s);
/** Parkings voiture par défaut ; `vehicle` : places motos (moto) ou arceaux vélo (bike). */
export const getParkings = (b: BBox, s?: AbortSignal, vehicle: Vehicle = 'car') =>
  list<Parking>(vehicle === 'car' ? '/v1/parkings' : `/v1/parkings?vehicle=${vehicle}`, b, s);
export const getReports = (b: BBox, s?: AbortSignal) => list<Report>('/v1/reports', b, s);
/** Le temps à l'arrivée : pluie (plus de 0,2 mm en un quart d'heure), froid (1 °C ou moins). */
export type Outlook = { rain: boolean; cold: boolean; temperature: number; rainMm: number };

/** Vigilance Météo-France en cours dans le département (à partir du jaune). */
export type Vigilance = { color: 'jaune' | 'orange' | 'rouge'; level: number; phenomena: string[]; department: string };

/** Météo à `at` vers l'heure `time` (ms) : prévision (null sans) et vigilance (null si verte). */
export const getWeather = (at: LatLon, time: number, signal?: AbortSignal) =>
  request<{ outlook: Outlook | null; vigilance: Vigilance | null }>(
    `/v1/weather?at=${at.lat},${at.lon}&time=${Math.round(time / 1000)}`,
    { signal },
  );

/** Prix moyen d'un carburant aujourd'hui sur la zone (prix officiels) ; null sans station qui le vend. */
export const getFuelPrice = (b: BBox, fuel: string, signal?: AbortSignal) =>
  list<{ day: string; avg: number; stations: number }>(`/v1/fuel-trend?fuel=${fuel}&days=1`, b, signal).then((d) => d.at(-1) ?? null);

/** Voitures électriques (Open EV Data) : batterie et consommation, pour estimer l'autonomie. */
export const getEvModels = () => request<{ updated: string; models: EvModel[] }>('/v1/ev-models').then((r) => r.models);

/** Zones à faibles émissions qui touchent la zone, en vigueur ou à venir. */
export const getZones = (b: BBox, s?: AbortSignal) => list<Zone>('/v1/zfe', b, s);

/** Un signalement du même type à moins de 150 m n'est pas dupliqué : il est confirmé et renvoyé. */
export const postReport = (kind: ReportKind, lat: number, lon: number) =>
  request<Report>('/v1/reports', { method: 'POST', body: JSON.stringify({ kind, lat, lon }) });

/** « Toujours là » (up) ou « Plus là ». 409 : c'est ton propre signalement. */
export const voteReport = (id: number, up: boolean) =>
  request<{ report: Report; removed: boolean }>(`/v1/reports/${id}/votes`, { method: 'POST', body: JSON.stringify({ up }) });

/** Arrêt de tram ou de bus. */
export type TransitStop = { id: string; name: string; lat: number; lon: number };

export type TransitLine = { id: string; name: string; mode: 'tram' | 'bus'; color: string; textColor: string };

/** Un tronçon en tram ou en bus, ou une correspondance à pied (`line` absent). Heures ISO. */
export type TransitLeg = {
  line?: TransitLine;
  headsign?: string;
  from: TransitStop;
  to: TransitStop;
  depart: string;
  arrive: string;
  stops?: number;
  /** Heures du temps réel (sinon : horaires théoriques). */
  realtime?: boolean;
};

/** Du parking relais à la destination ; `arrive` compte la marche finale (à vol d'oiseau). */
export type Journey = { legs: TransitLeg[]; arrive: string; boardWalk: number; finalWalk: number };

/** Se garer au parking relais, puis tram ou bus (correspondances comprises) : prochains trajets. */
export type ParkRide = { parking: Parking; journeys: Journey[] };

/** Parkings relais vers `to` sur le chemin depuis `from`, avec les trajets des deux prochaines heures. */
export function getParkRides(to: LatLon, from: LatLon | null, signal?: AbortSignal) {
  const q = [`to=${to.lat},${to.lon}`];
  if (from) q.push(`from=${from.lat},${from.lon}`);
  return request<{ options: ParkRide[] }>(`/v1/park-ride?${q.join('&')}`, { signal }).then((r) => r.options);
}

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
