// Client de l'API Zelo (services/api). Les formes suivent services/api/internal/store.

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
};

export type LiveEvent = { type: 'report'; report: Report };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

const list = <T>(path: string, bbox: BBox, signal?: AbortSignal) =>
  request<{ items: T[] }>(`${path}?bbox=${bbox.join(',')}`, { signal }).then((r) => r.items);

export const getFuelStations = (b: BBox, s?: AbortSignal) => list<FuelStation>('/v1/fuel-stations', b, s);
export const getChargeStations = (b: BBox, s?: AbortSignal) => list<ChargeStation>('/v1/charge-stations', b, s);
export const getReports = (b: BBox, s?: AbortSignal) => list<Report>('/v1/reports', b, s);

export const postReport = (kind: ReportKind, lat: number, lon: number) =>
  request<Report>('/v1/reports', { method: 'POST', body: JSON.stringify({ kind, lat, lon }) });
