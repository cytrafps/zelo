const euro = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export const formatPrice = (value: number) => `${euro.format(value)} €`;

/** « il y a 5 minutes », « hier »… */
export function formatAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
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
