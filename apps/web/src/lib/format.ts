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

/** « il y a 18 min », ou « à l'instant ». */
export const since = (from: Date, now: Date) => {
  const a = ago(from, now);
  return a === 'à l’instant' ? a : `il y a ${a}`;
};

/** Adresse du flux officiel, souvent en capitales : « 12 AVENUE DE LAON » devient « 12 Avenue de Laon ». */
export function address(s: string) {
  const t = s.trim();
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/(?<=[\s-])(De|Du|Des|La|Le|Les|Et|Sur|Sous|En|Aux?)(?=[\s-])/g, (w) => w.toLowerCase())
    .replace(/(?<=[\s-])([DL])['’](?=\p{L})/gu, (w) => w.toLowerCase())
    .replace(/(?<![\p{L}'’])(Rn|Rd|Zac|Zi|Za|Cc)(?![\p{L}'’])/gu, (w) => w.toUpperCase());
}

const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const dateCourte = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const annee = new Intl.DateTimeFormat('fr-FR', { year: 'numeric', timeZone: 'Europe/Paris' });
const iso = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris' });

/** « 3 octobre » */
export const formatDay = (d: Date) => date.format(d);

/** Jour de Paris au format AAAA-MM-JJ, pour les noms de fichiers (toISOString donne la veille avant 2 h). */
export const dayStamp = (now: Date) => iso.format(now);

/** Période d'une fermeture : « jusqu'au 7 novembre », « 10 → 14 nov. », « à partir du 3 décembre ». */
export function period(from: string | null, to: string | null, now: Date) {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  if (t && (!f || f <= now)) return `jusqu’au ${date.format(t)}`;
  if (f && t) {
    const [fy, ty] = [annee.format(f), annee.format(t)];
    // Sur deux années, l'année est écrite : « 3 déc. 2026 → 5 déc. 2027 », pas « 3 → 5 déc. ».
    if (fy !== ty) return `${dateCourte.format(f)} ${fy} → ${dateCourte.format(t)} ${ty}`;
    const sameMonth = dateCourte.format(f).split(' ').slice(1).join(' ') === dateCourte.format(t).split(' ').slice(1).join(' ');
    return `${sameMonth ? dateCourte.format(f).split(' ')[0] : dateCourte.format(f)} → ${dateCourte.format(t)}`;
  }
  if (f && f > now) return `à partir du ${date.format(f)}`;
  return 'sans date de fin';
}

/** Temps restant : « 2 h », « 18 min », « imminente ». */
export function within(to: Date, now: Date) {
  const a = ago(now, to);
  return a === 'à l’instant' ? 'imminente' : a;
}

/** « mis à jour il y a 2 min » ; `failed` : la requête a échoué avant toute donnée (elle est relancée toute seule). */
export const updated = (at: Date | null, now: Date, failed = false) =>
  at !== null ? `mis à jour ${since(at, now)}` : failed ? 'données indisponibles' : 'chargement…';

/** « Parking rue de Vesle » devient « Rue de Vesle » ; « Parking Erlon », « Erlon ». */
export const parkingName = (name: string) => {
  const n = name.replace(/^Parking\s+/i, '').trim();
  return n ? n[0]!.toUpperCase() + n.slice(1) : 'Sans nom';
};
