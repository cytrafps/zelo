import { useSyncExternalStore } from 'react';

// Six pages, pas de paramètres : un routeur d'une vingtaine de lignes suffit (nginx renvoie
// index.html pour toute adresse inconnue).
export const ROUTES = ['/', '/stationnement', '/recharge', '/carburant', '/signalements', '/api'] as const;
export type Route = (typeof ROUTES)[number];

const current = (): Route => {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/';
};

const subscribe = (notify: () => void) => {
  const on = () => {
    moved = true; // précédent et suivant du navigateur aussi
    notify();
  };
  addEventListener('popstate', on);
  return () => removeEventListener('popstate', on);
};

export const useRoute = () => useSyncExternalStore(subscribe, current);

let moved = false;
/** Vrai après une navigation dans l'app (pas au premier chargement de la page). */
export const navigated = () => moved;

export function navigate(to: Route) {
  if (to === current()) return;
  moved = true;
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo(0, 0);
}
