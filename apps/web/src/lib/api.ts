// Les mêmes routes que l'app mobile, servies sous /v1 à la même origine (nginx relaie vers l'API).
export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Grand Reims : de Fismes à Suippes, de Beine-Nauroy à Ville-en-Selve. */
export const GRAND_REIMS: BBox = [3.66, 49.06, 4.42, 49.46];
/** Centre de Reims, pour la carte et les parkings du centre. */
export const CENTRE: BBox = [3.995, 49.236, 4.06, 49.272];

export type ChargeStation = {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
  maxPowerKw: number;
  total: number;
  /** null : aucun état publié depuis 24 h. */
  available: number | null;
  observedAt: string | null;
};

export type Price = { minutes: number; cents: number };

export type Parking = {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
  capacity: number | null;
  fee: boolean | null;
  parkRide: boolean;
  covered: boolean;
  tariff: { free: number; prices: Price[]; source: string; checked: string } | null;
};

export type FuelStation = {
  id: string;
  lat: number;
  lon: number;
  address: string;
  city: string;
  prices: Record<string, number>;
  updatedAt: string;
};

export type ReportKind = 'accident' | 'bouchon' | 'travaux' | 'obstacle' | 'route_fermee' | 'place_liberee' | 'borne_hs';

export type Report = {
  id: number;
  kind: ReportKind;
  lat: number;
  lon: number;
  createdAt: string;
  expiresAt: string;
  confirmations: number;
  denials: number;
};

const bbox = (b: BBox) => `bbox=${b.join(',')}`;

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`);
  return (await res.json()) as T;
}

const items = <T>(path: string) => (signal?: AbortSignal) => get<{ items: T[] }>(path, signal).then((r) => r.items);

export const api = {
  chargeStations: (b: BBox) => items<ChargeStation>(`/v1/charge-stations?${bbox(b)}`),
  parkings: (b: BBox) => items<Parking>(`/v1/parkings?${bbox(b)}`),
  fuelStations: (b: BBox) => items<FuelStation>(`/v1/fuel-stations?${bbox(b)}`),
  reports: (b: BBox) => items<Report>(`/v1/reports?${bbox(b)}`),
};

/** Rue la plus proche (Géoplateforme de l'IGN, sans clé), pour situer un signalement. */
export async function streetAt(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  const r = await get<{ features: { properties: { street?: string; name?: string; city?: string } }[] }>(
    `https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&limit=1&index=address`,
    signal,
  );
  const p = r.features[0]?.properties;
  return p ? (p.street ?? p.name ?? p.city ?? null) : null;
}
