// Mise en forme française : espaces fines insécables comme dans la maquette (« 3 418 », « 72 % »).
const nombre = new Intl.NumberFormat('fr-FR');
const euros = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });

export const formatNumber = (n: number) => nombre.format(n);
export const formatPercent = (ratio: number) => `${nombre.format(Math.round(ratio * 100))}\u202f%`;
export const formatLitre = (price: number) => `${euros.format(price)} €`;
export const formatCents = (cents: number) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} €`;

/** « Aujourd'hui, jeudi 29 octobre » */
export const today = (now: Date) => `Aujourd’hui, ${jour.format(now)}`;

/** Durée écoulée courte : « 18 min », « 2 h », « 3 j ». */
export function ago(from: Date, now: Date) {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 1) return 'à l’instant';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} j`;
}

/** « mis à jour il y a 2 min » */
export const updated = (at: Date | null, now: Date) =>
  at === null ? 'chargement…' : ago(at, now) === 'à l’instant' ? 'mis à jour à l’instant' : `mis à jour il y a ${ago(at, now)}`;

/** « Parking rue de Vesle » devient « Rue de Vesle » ; « Parking Erlon », « Erlon ». */
export const parkingName = (name: string) => {
  const n = name.replace(/^Parking\s+/i, '').trim();
  return n ? n[0]!.toUpperCase() + n.slice(1) : 'Sans nom';
};
