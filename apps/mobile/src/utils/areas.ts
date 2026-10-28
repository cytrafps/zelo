// Aires d'autoroute sur le trajet : ce que l'app en dit, sans dépendance (testé avec `npm test`).
import { FUEL_ORDER } from './format.ts';
import type { Area, AreaService } from './route.ts';

const SERVICE_LABEL: Record<AreaService, string> = {
  restauration: 'Restauration',
  boutique: 'Boutique',
  toilettes: 'Toilettes',
  douches: 'Douches',
  'camping-car': 'Camping-car',
  'pique-nique': 'Pique-nique',
  jeux: 'Jeux',
};

/** « Aire de Reims Champagne-Sud » ; une aire sans nom prend celui de son type. */
export const areaName = (a: Area) => a.name || (a.kind === 'services' ? 'Aire de service' : 'Aire de repos');

/** « Restauration · Douches · Camping-car » : les services, dans l'ordre fourni par l'API. */
export const areaServices = (a: Area) => a.services.map((s) => SERVICE_LABEL[s]).join(' · ');

/** « Gazole 1,76 € · E10 1,85 € » : les deux carburants les plus courants que l'aire vend. */
export function areaFuel(a: Area) {
  if (!a.fuel) return '';
  return FUEL_ORDER.filter((f) => f in a.fuel!)
    .slice(0, 2)
    .map((f) => `${f} ${a.fuel![f].toFixed(2).replace('.', ',')} €`)
    .join(' · ');
}

/** « 3/4 bornes libres », « 4 bornes » sans état publié. */
export function areaCharge(a: Area) {
  if (!a.charge) return '';
  const { total, available } = a.charge;
  if (available === null) return `${total} borne${total > 1 ? 's' : ''}`;
  return `${available}/${total} borne${total > 1 ? 's' : ''} libre${available > 1 ? 's' : ''}`;
}

/** Prochaine aire devant soi (à `traveled` mètres du départ), si elle est à moins de `within` mètres. */
export function nextArea(areas: readonly Area[] | undefined, traveled: number, within = 50_000) {
  return areas?.find((a) => a.along > traveled && a.along - traveled <= within);
}
