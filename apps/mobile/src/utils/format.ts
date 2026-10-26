// Hermes (le moteur JavaScript de l'app) fournit Intl.NumberFormat mais pas Intl.RelativeTimeFormat :
// les durées relatives sont donc formatées à la main.
const euro = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const formatPrice = (value: number) => `${euro.format(value)} €`;

/** « il y a 5 min », « dans 2 h », « hier », « à l'instant »… */
export function formatAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  const past = minutes <= 0;
  const m = Math.abs(minutes);
  if (m < 1) return 'à l’instant';
  const rel = (n: number, unit: string) => (past ? `il y a ${n} ${unit}` : `dans ${n} ${unit}`);
  if (m < 60) return rel(m, 'min');
  const h = Math.round(m / 60);
  if (h < 24) return rel(h, 'h');
  const d = Math.round(h / 24);
  if (d === 1) return past ? 'hier' : 'demain';
  return rel(d, 'jours');
}

/** Ordre d'affichage des carburants, du plus courant au plus rare. */
export const FUEL_ORDER = ['Gazole', 'E10', 'SP95', 'SP98', 'E85', 'GPLc'];

export const SOCKET_LABEL: Record<string, string> = {
  type2: 'Type 2',
  ccs: 'CCS',
  chademo: 'CHAdeMO',
  ef: 'Domestique',
  autre: 'Autre',
};
