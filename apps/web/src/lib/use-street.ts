import { useEffect, useState } from 'react';

import { type Report, streetAt } from './api';

// Rue de chaque signalement, demandée une fois (les signalements ne bougent pas).
const streets = new Map<number, Promise<string | null>>();

/** Rue du signalement ; undefined pendant la recherche, null si elle est introuvable. */
export function useStreet(r: Report) {
  const [street, setStreet] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let p = streets.get(r.id);
    if (!p) {
      p = streetAt(r.lat, r.lon).catch(() => {
        streets.delete(r.id); // échec réseau : on retentera au prochain affichage
        return null;
      });
      streets.set(r.id, p);
    }
    void p.then((v) => live && setStreet(v));
    return () => {
      live = false;
    };
  }, [r.id, r.lat, r.lon]);
  return street;
}
