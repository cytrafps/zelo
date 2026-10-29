import { distance } from './geo';
import type { ChargeStation, FuelDay, FuelStation, Parking, Report, ReportKind } from './api';

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

/** Lignes du tableau Stationnement : parkings à tarif relevé, puis les plus grands, puis les P+R. */
export function parkingTable(centre: Parking[], relays: Parking[], n: number) {
  const seen = new Set<string>();
  const rows: Parking[] = [];
  const add = (p: Parking) => {
    if (seen.has(p.id) || rows.length >= n) return;
    seen.add(p.id);
    rows.push(p);
  };
  const byCapacity = (a: Parking, b: Parking) => (b.capacity ?? 0) - (a.capacity ?? 0);
  centre.filter((p) => p.tariff !== null).sort(byCapacity).forEach(add);
  centre.filter((p) => p.tariff === null && p.capacity !== null && !p.parkRide).sort(byCapacity).slice(0, Math.max(0, n - 3 - rows.length)).forEach(add);
  relays.filter((p) => p.parkRide).sort(byCapacity).forEach(add);
  return rows;
}

/** Places et places PMR connues, et parkings sans nombre de places dans OpenStreetMap. */
export function capacitySummary(parkings: Parking[]) {
  let places = 0;
  let disabled = 0;
  let withDisabled = 0;
  let unknown = 0;
  for (const p of parkings) {
    if (p.capacity === null) unknown++;
    else places += p.capacity;
    if (p.disabled !== null) {
      disabled += p.disabled;
      withDisabled++;
    }
  }
  return { places, disabled, withDisabled, unknown, total: parkings.length };
}

/** Distance (m) sous laquelle un signalement « borne hors service » vise la station. */
export const BROKEN_WITHIN_M = 60;

export type StationState = 'service' | 'complet' | 'panne' | 'inconnu';

/** État d'une station : panne signalée par un conducteur, sinon l'état publié par l'opérateur. */
export function stationState(st: ChargeStation, broken: Report[]): StationState {
  if (broken.some((r) => distance(r, st) <= BROKEN_WITHIN_M)) return 'panne';
  if (st.available === null) return 'inconnu';
  return st.available === 0 ? 'complet' : 'service';
}

/** La station la plus proche d'un signalement, à moins de `within` mètres. */
export function nearestStation(r: Report, stations: ChargeStation[], within = 100) {
  let best: { station: ChargeStation; d: number } | null = null;
  for (const st of stations) {
    const d = distance(r, st);
    if (d <= within && (!best || d < best.d)) best = { station: st, d };
  }
  return best?.station ?? null;
}

/** Points rapides (50 kW et plus) et prix moyen du kWh parmi les stations qui le publient. */
export function chargeOffer(stations: ChargeStation[]) {
  let fast = 0;
  let fastStations = 0;
  let sum = 0;
  let priced = 0;
  for (const st of stations) {
    if (st.maxPowerKw >= 50) {
      fast += st.total;
      fastStations++;
    }
    if (st.price && !st.price.free && st.price.kwh > 0) {
      sum += st.price.kwh;
      priced++;
    }
  }
  return { fast, fastStations, avgKwh: priced ? sum / priced : null, priced };
}

const WEEK_MS = 7 * 86_400_000;

/** Stations dont les prix ont été relevés depuis moins de 7 jours (plus vieux : station sans doute fermée). */
export const freshFuel = (stations: FuelStation[], now: Date) =>
  stations.filter((s) => Date.parse(s.updatedAt) >= now.getTime() - WEEK_MS);

/** Moyenne, minimum et maximum d'un carburant sur des stations ; null si aucune ne le vend. */
export function fuelStats(stations: FuelStation[], fuel: string) {
  const prices = stations.map((s) => s.prices[fuel]).filter((p): p is number => p !== undefined);
  if (!prices.length) return null;
  return {
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: prices.length,
  };
}

/**
 * Jours d'historique jugés complets : l'historique se constitue au fil des imports, les
 * premiers jours ne portent que sur les stations dont le prix a changé depuis. Un jour compte
 * s'il couvre au moins 90 % des stations du dernier jour.
 */
export function completeDays(days: FuelDay[]) {
  const last = days.at(-1);
  if (!last) return [];
  return days.filter((d) => d.stations >= 0.9 * last.stations);
}

/** Évolution (euros) du prix moyen sur 7 jours ; null si l'historique ne remonte pas assez. */
export function weekChange(days: FuelDay[]) {
  const ok = completeDays(days);
  const last = ok.at(-1);
  if (!last) return null;
  const target = new Date(`${last.day}T12:00:00Z`).getTime() - WEEK_MS;
  const before = ok.find((d) => new Date(`${d.day}T12:00:00Z`).getTime() === target);
  return before ? last.avg - before.avg : null;
}

export type ReportState = 'confirme' | 'verifier' | 'nouveau';

/** Confirmé : plus de « oui » que de « non » ; à vérifier : au moins autant de « non » que de « oui ». */
export const reportState = (r: Report): ReportState =>
  r.confirmations > r.denials ? 'confirme' : r.denials > 0 ? 'verifier' : 'nouveau';
