import { useEffect, useState } from 'react';

export type Polled<T> = { data: T | null; at: Date | null; error: boolean };

/**
 * Charge tout de suite, puis toutes les `everyMs` tant que l'onglet est visible ; une erreur
 * garde les dernières données (le tableau de bord ne se vide pas sur une coupure). Un tour est
 * sauté tant que la requête précédente n'a pas répondu : l'annuler à chaque tour empêchait toute
 * réponse sur un réseau plus lent que l'intervalle.
 */
export function usePoll<T>(load: (signal: AbortSignal) => Promise<T>, everyMs: number, key: string): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, at: null, error: false });
  useEffect(() => {
    const ctl = new AbortController();
    let pending = false;
    const run = () => {
      if (document.hidden || pending) return;
      pending = true;
      load(ctl.signal)
        .then(
          (data) => setState({ data, at: new Date(), error: false }),
          (e: unknown) => {
            if ((e as Error).name !== 'AbortError') setState((s) => ({ ...s, error: true }));
          },
        )
        .finally(() => (pending = false));
    };
    run();
    const id = setInterval(run, everyMs);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
      ctl.abort();
    };
    // `key` identifie la requête : `load` est recréée à chaque rendu.
  }, [key, everyMs]);
  return state;
}

/** L'heure, rafraîchie chaque minute (« il y a 2 min »). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
