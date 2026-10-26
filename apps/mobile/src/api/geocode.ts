// Géocodage de la Géoplateforme (IGN), successeur de l'API Adresse : gratuit, sans clé.
// Index « address » (Base Adresse Nationale) et « poi » (lieux : gare, cathédrale, parking…).
import { rankByProximity } from '@/utils/geo';

const SEARCH_URL = 'https://data.geopf.fr/geocodage/search';

export type Place = {
  id: string;
  /** Libellé complet, pour le champ de recherche : « Gare de Reims, Reims ». */
  label: string;
  /** Ligne principale : « Gare de Reims », « 12 Rue de Vesle ». */
  name: string;
  /** Ligne secondaire : « 51100 Reims ». */
  detail: string;
  lat: number;
  lon: number;
};

type AddressProps = { _type: 'address'; id: string; label: string; name: string; postcode?: string; city?: string; type: string; score: number };
type PoiProps = { _type: 'poi'; toponym: string; postcode?: string[]; city?: string[]; score: number };
type Feature = { geometry: { coordinates: [number, number] }; properties: AddressProps | PoiProps };

function toPlace({ geometry, properties: p }: Feature) {
  const [lon, lat] = geometry.coordinates;
  if (p._type === 'poi') {
    const city = p.city?.[0] ?? '';
    const detail = [p.postcode?.[0], city].filter(Boolean).join(' ');
    return { id: `poi:${p.toponym}:${lon}:${lat}`, label: city ? `${p.toponym}, ${city}` : p.toponym, name: p.toponym, detail, lat, lon, score: p.score };
  }
  const detail = p.type === 'municipality' ? (p.postcode ?? '') : [p.postcode, p.city].filter(Boolean).join(' ');
  return { id: p.id, label: p.label, name: p.name, detail, lat, lon, score: p.score, municipality: p.type === 'municipality' };
}

export async function searchPlaces(query: string, near: { lat: number; lon: number }, signal: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    index: 'address,poi',
    limit: '10',
    autocomplete: '1',
    lat: near.lat.toFixed(4),
    lon: near.lon.toFixed(4),
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`géocodage : HTTP ${res.status}`);
  const { features } = (await res.json()) as { features: Feature[] };
  return rankByProximity(features.map(toPlace), near, 5).map(
    (p): Place => ({ id: p.id, label: p.label, name: p.name, detail: p.detail, lat: p.lat, lon: p.lon }),
  );
}
