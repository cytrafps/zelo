import { useEffect, useState } from 'react';

import { searchPlaces, type Place } from '@/api/geocode';

export const MIN_QUERY = 3;

type Result = { query: string; places: Place[]; failed: boolean };

/** Suggestions d'adresses pendant la frappe : 250 ms d'attente, requête précédente annulée. */
export function useGeocode(query: string, near: { lat: number; lon: number }) {
  const [result, setResult] = useState<Result>({ query: '', places: [], failed: false });
  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_QUERY) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(q, near, ctl.signal)
        .then((places) => setResult({ query: q, places, failed: false }))
        .catch(() => {
          if (!ctl.signal.aborted) setResult({ query: q, places: [], failed: true });
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // Le biais géographique n'a pas à relancer la recherche quand la carte bouge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = q.length >= MIN_QUERY;
  return {
    places: active ? result.places : [],
    loading: active && result.query !== q,
    failed: active && result.query === q && result.failed,
  };
}
