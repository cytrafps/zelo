import { useCallback, useRef, useState } from 'react';

import type { Place } from '@/api/geocode';
import { ApiError, getRoutes, type Avoid, type ChargeStation, type Parking } from '@/api/zelo';
import { useStored } from '@/hooks/use-stored';
import type { Fix } from '@/utils/geo';
import type { Route } from '@/utils/route';
import { needsWalk, targetPoint, type Target } from '@/utils/targets';

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
  /** Heure de départ choisie (ms) ; null : maintenant. */
  depart: number | null;
  loading: boolean;
  error: string | null;
};

type Request = { from: Fix; destination: Place; target: TripTarget; depart: number | null; avoid: readonly Avoid[] };

const message = (e: unknown) =>
  e instanceof ApiError && e.status === 422 ? e.message : 'Itinéraire indisponible, vérifie ta connexion.';

/**
 * Trajet en cours : calcule les itinéraires voiture (avec alternatives) jusqu'au point d'arrêt,
 * et le trajet à pied du point d'arrêt à la destination.
 */
export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(null);
  /** Péages et autoroutes à éviter : gardés d'un trajet à l'autre, comme dans Plans. */
  const [avoid, setAvoidStored] = useStored<Avoid[]>('trajet.eviter', []);
  const request = useRef<AbortController | null>(null);
  /** Numéro du trajet demandé en dernier : une préparation plus ancienne (position, arrêts) est ignorée. */
  const seq = useRef(0);

  const abortable = () => {
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    return ctl;
  };

  const load = useCallback(async ({ from, destination, target, depart, avoid }: Request, alternates: number) => {
    const ctl = abortable();
    setTrip((t) => (t ? { ...t, target, depart, loading: true, error: null } : t));
    try {
      const stop = targetPoint(target, destination);
      const [routes, walk] = await Promise.all([
        getRoutes(from, stop, 'car', { alternates, heading: from.heading, depart, avoid }, ctl.signal),
        !needsWalk(target)
          ? Promise.resolve(null)
          : getRoutes(stop, destination, 'walk', {}, ctl.signal).then((r) => r[0]),
      ]);
      if (ctl.signal.aborted) return;
      setTrip((t) => (t ? { ...t, routes, selected: 0, walk, loading: false } : t));
    } catch (e) {
      if (!ctl.signal.aborted) setTrip((t) => (t ? { ...t, loading: false, error: message(e) } : t));
    }
  }, []);

  /**
   * Ouvre l'aperçu tout de suite, en chargement, pendant qu'on cherche la position et les arrêts.
   * Renvoie le numéro à passer à `start` (ou `cancel`).
   */
  const open = useCallback((destination: Place) => {
    request.current?.abort();
    setTrip({ destination, target: { kind: 'dropoff' }, options: [], phase: 'preview', routes: [], selected: 0, walk: null, depart: null, loading: true, error: null });
    return ++seq.current;
  }, []);

  /** Calcule l'aperçu vers `destination` ; `options[0]` est l'arrêt proposé par défaut. */
  const start = useCallback(
    (token: number, from: Fix, destination: Place, options: TripTarget[]) => {
      if (token !== seq.current) return; // fermé, ou une autre destination choisie entre-temps
      const target = options[0] ?? { kind: 'dropoff' };
      setTrip({ destination, target, options, phase: 'preview', routes: [], selected: 0, walk: null, depart: null, loading: true, error: null });
      void load({ from, destination, target, depart: null, avoid }, 2);
    },
    [load, avoid],
  );

  /** En aperçu : change l'arrêt, l'heure de départ ou les évitements, puis recalcule. */
  const update = useCallback(
    (from: Fix, change: { target?: TripTarget; depart?: number | null; avoid?: Avoid[] }) => {
      if (!trip) return;
      if (change.avoid) setAvoidStored(change.avoid);
      void load(
        {
          from,
          destination: trip.destination,
          target: change.target ?? trip.target,
          depart: change.depart !== undefined ? change.depart : trip.depart,
          avoid: change.avoid ?? avoid,
        },
        2,
      );
    },
    [load, trip, avoid, setAvoidStored],
  );

  const select = useCallback((i: number) => setTrip((t) => (t ? { ...t, selected: i } : t)), []);

  /** Lance le guidage sur l'itinéraire choisi : on part maintenant. */
  const go = useCallback(
    (i: number) =>
      setTrip((t) => (t && t.routes[i] ? { ...t, phase: 'drive', routes: [t.routes[i]], selected: 0, depart: null } : t)),
    [],
  );

  /** Hors itinéraire : nouveau calcul depuis la position actuelle, sans alternatives. */
  const reroute = useCallback(
    async (from: Fix) => {
      if (!trip) return;
      if (trip.phase !== 'walk') return load({ from, destination: trip.destination, target: trip.target, depart: null, avoid }, 0);
      const ctl = abortable();
      try {
        const [walk] = await getRoutes(from, trip.destination, 'walk', {}, ctl.signal);
        if (ctl.signal.aborted) return;
        setTrip((t) => (t && t.phase === 'walk' ? { ...t, routes: [walk], walk } : t));
      } catch {
        // On garde l'ancien tracé : la position suivante relancera le calcul.
      }
    },
    [load, trip, avoid],
  );

  /** Arrivé au point d'arrêt : la suite se fait à pied, s'il y a lieu. */
  const parked = useCallback(() => {
    setTrip((t) => (t && t.walk ? { ...t, phase: 'walk', routes: [t.walk], selected: 0 } : null));
  }, []);

  const end = useCallback(() => {
    seq.current++;
    request.current?.abort();
    setTrip(null);
  }, []);

  /** Préparation `token` abandonnée (pas de position) : ferme l'aperçu s'il est toujours le sien. */
  const cancel = useCallback(
    (token: number) => {
      if (token === seq.current) end();
    },
    [end],
  );

  return { trip, avoid, open, start, cancel, update, select, go, reroute, parked, end };
}
