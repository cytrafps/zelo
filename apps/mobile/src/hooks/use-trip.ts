import { useCallback, useRef, useState } from 'react';

import type { Place } from '@/api/geocode';
import { ApiError, getRoutes, type ChargeStation, type Parking } from '@/api/zelo';
import type { LatLon } from '@/utils/geo';
import type { Route } from '@/utils/route';
import { targetPoint, type Target } from '@/utils/targets';

export type TripTarget = Target<Parking, ChargeStation>;

/** aperçu (03) → en voiture (04) → à pied (05c) ; fin quand on arrive. */
export type Phase = 'preview' | 'drive' | 'walk';

export type Trip = {
  destination: Place;
  target: TripTarget;
  options: TripTarget[];
  phase: Phase;
  /** En aperçu : le meilleur puis les alternatives. En guidage : le trajet suivi. */
  routes: Route[];
  selected: number;
  /** Du point d'arrêt à la destination ; null pour une dépose. */
  walk: Route | null;
  loading: boolean;
  error: string | null;
};

const message = (e: unknown) =>
  e instanceof ApiError && e.status === 422 ? e.message : 'Itinéraire indisponible, vérifie ta connexion.';

/**
 * Trajet en cours : calcule les itinéraires voiture (avec alternatives) jusqu'au point d'arrêt,
 * et le trajet à pied du point d'arrêt à la destination.
 */
export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (from: LatLon, destination: Place, target: TripTarget, alternates: number) => {
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setTrip((t) => (t ? { ...t, target, loading: true, error: null } : t));
    try {
      const stop = targetPoint(target, destination);
      const [routes, walk] = await Promise.all([
        getRoutes(from, stop, 'car', alternates, ctl.signal),
        target.kind === 'dropoff' ? Promise.resolve(null) : getRoutes(stop, destination, 'walk', 0, ctl.signal).then((r) => r[0]),
      ]);
      if (ctl.signal.aborted) return;
      setTrip((t) => (t ? { ...t, routes, selected: 0, walk, loading: false } : t));
    } catch (e) {
      if (!ctl.signal.aborted) setTrip((t) => (t ? { ...t, loading: false, error: message(e) } : t));
    }
  }, []);

  /** Ouvre l'aperçu vers `destination` ; `options[0]` est l'arrêt proposé par défaut. */
  const start = useCallback(
    (from: LatLon, destination: Place, options: TripTarget[]) => {
      const target = options[0] ?? { kind: 'dropoff' };
      setTrip({ destination, target, options, phase: 'preview', routes: [], selected: 0, walk: null, loading: true, error: null });
      void load(from, destination, target, 2);
    },
    [load],
  );

  const setTarget = useCallback(
    (from: LatLon, target: TripTarget) => {
      if (trip) void load(from, trip.destination, target, 2);
    },
    [load, trip],
  );

  const select = useCallback((i: number) => setTrip((t) => (t ? { ...t, selected: i } : t)), []);

  /** Lance le guidage sur l'itinéraire choisi. */
  const go = useCallback(
    (i: number) => setTrip((t) => (t && t.routes[i] ? { ...t, phase: 'drive', routes: [t.routes[i]], selected: 0 } : t)),
    [],
  );

  /** Hors itinéraire : nouveau calcul depuis la position actuelle, sans alternatives. */
  const reroute = useCallback(
    async (from: LatLon) => {
      if (!trip) return;
      if (trip.phase !== 'walk') return load(from, trip.destination, trip.target, 0);
      try {
        const [walk] = await getRoutes(from, trip.destination, 'walk');
        setTrip((t) => (t && t.phase === 'walk' ? { ...t, routes: [walk], walk } : t));
      } catch {
        // On garde l'ancien tracé : la position suivante relancera le calcul.
      }
    },
    [load, trip],
  );

  /** Arrivé au point d'arrêt : la suite se fait à pied, s'il y a lieu. */
  const parked = useCallback(() => {
    setTrip((t) => (t && t.walk ? { ...t, phase: 'walk', routes: [t.walk], selected: 0 } : null));
  }, []);

  const end = useCallback(() => {
    request.current?.abort();
    setTrip(null);
  }, []);

  return { trip, start, setTarget, select, go, reroute, parked, end };
}
