import type { ChargeStation, FuelStation, Parking, Report, ReportKind } from './api';

/** Points de charge libres parmi ceux dont l'état est publié depuis moins de 24 h. */
export function chargeSummary(stations: ChargeStation[]) {
  let free = 0;
  let known = 0;
  let unknown = 0;
  for (const s of stations) {
    if (s.available === null) unknown += s.total;
    else {
      free += Math.min(s.available, s.total);
      known += s.total;
    }
  }
  return { free, known, unknown, ratio: known > 0 ? free / known : null };
}

export const REPORT_LABEL: Record<ReportKind, string> = {
  accident: 'Accident',
  bouchon: 'Bouchon',
  travaux: 'Travaux',
  obstacle: 'Obstacle',
  route_fermee: 'Route fermée',
  place_liberee: 'Place libérée',
  borne_hs: 'Borne hors service',
};

/** Signalements actifs et le type le plus fréquent (« dont 3 travaux »). */
export function reportSummary(reports: Report[]) {
  const byKind = new Map<ReportKind, number>();
  for (const r of reports) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  let top: { kind: ReportKind; count: number } | null = null;
  for (const [kind, count] of byKind) if (!top || count > top.count) top = { kind, count };
  return { count: reports.length, top };
}

/** Les plus récents d'abord. */
export const recentReports = (reports: Report[], n: number) =>
  [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);

/** Station la moins chère pour un carburant, avec un prix relevé depuis moins de 7 jours. */
export function cheapest(stations: FuelStation[], fuel: string, now: Date) {
  const week = now.getTime() - 7 * 86_400_000;
  let best: { station: FuelStation; price: number } | null = null;
  for (const s of stations) {
    const price = s.prices[fuel];
    if (price === undefined || Date.parse(s.updatedAt) < week) continue;
    if (!best || price < best.price) best = { station: s, price };
  }
  return best;
}

/** Prix pour une heure (centimes), d'après la grille relevée chez l'exploitant ; null sinon. */
export const hourPrice = (p: Parking) => p.tariff?.prices.find((x) => x.minutes === 60)?.cents ?? null;

/** Parkings à tarif relevé (exploités : Champagne Parc Auto, Effia), les plus grands d'abord. */
export const operatedParkings = (parkings: Parking[], n: number) =>
  parkings
    .filter((p) => p.tariff !== null)
    .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))
    .slice(0, n);
