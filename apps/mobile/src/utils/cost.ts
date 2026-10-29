// Coût d'un trajet en voiture : énergie (carburant ou électricité) au prix relevé autour du
// départ, divisée entre les passagers. Sans dépendance, testé avec `npm test`.

/** Carburants du flux officiel des prix (data.gouv.fr). */
export type Fuel = 'Gazole' | 'E10' | 'SP95' | 'SP98' | 'E85' | 'GPLc';

export const FUELS: readonly { fuel: Fuel; label: string; litresPer100: number }[] = [
  // Consommation proposée au départ, à ajuster dans la fiche voiture : l'E85 et le GPL brûlent
  // environ 25 % de volume en plus que l'essence pour la même distance.
  { fuel: 'Gazole', label: 'Gazole', litresPer100: 5.5 },
  { fuel: 'E10', label: 'SP95-E10', litresPer100: 6.5 },
  { fuel: 'SP95', label: 'SP95', litresPer100: 6.5 },
  { fuel: 'SP98', label: 'SP98', litresPer100: 6.5 },
  { fuel: 'E85', label: 'E85', litresPer100: 8 },
  { fuel: 'GPLc', label: 'GPL', litresPer100: 8 },
];

export const fuelLabel = (f: Fuel) => FUELS.find((x) => x.fuel === f)?.label ?? f;

/** Voiture thermique telle que réglée dans la fiche voiture. */
export type Combustion = { fuel: Fuel; litresPer100: number };

/** Consommations proposées (L/100 km). */
export const LITRE_STEPS = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10];

/**
 * Prix du kWh pour une voiture électrique. Chez soi : tarif réglementé EDF (Tarif Bleu, 6 kVA),
 * en vigueur au 1er août 2026 ; en borne : la moyenne des prix fermes publiés autour du départ.
 */
export type ChargeAt = 'base' | 'creuses' | 'borne';
export const HOME_KWH: Record<Exclude<ChargeAt, 'borne'>, number> = { base: 0.2001, creuses: 0.1589 };

/** Énergie consommée sur `meters` : litres, ou kWh. */
export const energyUsed = (per100: number, meters: number) => (meters / 100_000) * per100;

/** Coût (euros) pour `meters`, à `per100` unités aux 100 km et `price` euros l'unité. */
export const tripCost = (per100: number, price: number, meters: number) => energyUsed(per100, meters) * price;

const euros = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** « ≈ 4,20 € », ou « ≈ 4,20 € · 2,10 €/pers. » à plusieurs. Sous 10 centimes : « < 0,10 € ». */
export function formatCost(total: number, people = 1) {
  if (total < 0.1) return '< 0,10 €';
  const all = `≈ ${euros.format(total)} €`;
  return people > 1 ? `${all} · ${euros.format(total / people)} €/pers.` : all;
}

/**
 * Coût affiché sous un itinéraire : énergie et péage, partagés entre les passagers. `total` n'est
 * renseigné que si tout est chiffré (énergie connue, péage complet) : c'est lui qui compare les
 * itinéraires. null quand on ne connaît ni l'un ni l'autre.
 */
export function routeCost(energy: number | null, toll: { price: number; complete: boolean } | undefined, people = 1) {
  if (energy === null && !toll) return null;
  const unpriced = toll && !toll.complete && toll.price === 0;
  const tollText = !toll ? '' : unpriced ? 'péage non chiffré' : `${toll.complete ? '' : 'au moins '}${euros.format(toll.price)} € de péage`;
  const total = energy !== null && (!toll || toll.complete) ? energy + (toll?.price ?? 0) : null;
  if (energy === null) return { total, text: tollText };
  if (unpriced) return { total, text: `${formatCost(energy, people)} + ${tollText}` };
  const base = formatCost(energy + (toll?.price ?? 0), people);
  return { total, text: toll ? `${base} dont ${tollText}` : base };
}

/** Index de l'itinéraire le moins cher, s'il l'est d'au moins 50 centimes et que tous sont chiffrés ; sinon -1. */
export function cheapestRoute(totals: readonly (number | null)[]) {
  if (totals.length < 2 || totals.some((t) => t === null)) return -1;
  const all = totals as number[];
  const lo = Math.min(...all);
  return Math.max(...all) - lo >= 0.5 ? all.indexOf(lo) : -1;
}

/** Moyenne des prix au kWh fermes (sans « dès », qui n'est qu'un minimum) ; null sans aucun. */
export function averageKwh(stations: readonly { price: { free: boolean; kwh: number; from: boolean } | null }[]) {
  const prices = stations.flatMap((s) => (s.price && !s.price.free && !s.price.from && s.price.kwh > 0 ? [s.price.kwh] : []));
  return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
}
