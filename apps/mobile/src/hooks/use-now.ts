import { useEffect, useState } from 'react';

/** Heure courante, rafraîchie toutes les `every` ms (heures d'arrivée affichées). */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
