// Autonomie de la voiture électrique (Open EV Data, voir l'API /v1/ev-models) : sans dépendance,
// testé avec `npm test`.

export type EvModel = {
  id: string;
  brand: string;
  model: string;
  variant: string;
  year: number | null;
  /** Batterie utilisable. */
  batteryKwh: number;
  /** Consommation moyenne mixte. */
  kwhPer100km: number;
  acKw: number | null;
  dcKw: number | null;
  ports: string[];
};

/** Sous ce niveau à l'arrivée, on propose de recharger. */
export const LOW_PERCENT = 15;
/** Par temps froid, la consommation grimpe (chauffage, batterie froide). */
const COLD_FACTOR = 1.2;

/** Batterie à l'arrivée (%), après `meters` de route ; négative si la voiture n'y arrive pas. */
export function arrivalPercent(m: Pick<EvModel, 'batteryKwh' | 'kwhPer100km'>, startPercent: number, meters: number, cold = false) {
  const used = (meters / 100_000) * m.kwhPer100km * (cold ? COLD_FACTOR : 1);
  return startPercent - (used / m.batteryKwh) * 100;
}

export const evName = (m: EvModel) => [m.brand, m.model, m.variant, m.year].filter(Boolean).join(' ');

/** Les modèles dont le nom contient tous les mots cherchés (« zoe 52 », « tesla model 3 »), récents d'abord. */
export function searchModels(models: readonly EvModel[], query: string, limit = 20) {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return models
    .filter((m) => {
      const name = fold(evName(m));
      return words.every((w) => name.includes(w));
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, limit);
}
