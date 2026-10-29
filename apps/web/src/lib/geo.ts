type LatLon = { lat: number; lon: number };

/** Distance à vol d'oiseau en mètres (équirectangulaire : précise à l'échelle d'une ville). */
export function distance(a: LatLon, b: LatLon) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
}
