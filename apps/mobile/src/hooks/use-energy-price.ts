import { useEffect, useState } from 'react';

import { getChargeStations, getFuelPrice, type BBox } from '@/api/zelo';
import { averageKwh, HOME_KWH, type ChargeAt, type Fuel } from '@/utils/cost';
import type { LatLon } from '@/utils/geo';

/** Ce qui fixe le prix de l'énergie : un carburant, ou un mode de recharge. */
export type EnergySource = { kind: 'fuel'; fuel: Fuel } | { kind: 'electric'; at: ChargeAt };

/** undefined : en cours ; null : aucun prix publié autour du départ ; 'error' : réseau ou API en échec. */
export type EnergyPrice = { price: number; where: string } | null | undefined | 'error';

/** Zone autour du départ : ~10 km, puis ~30 km s'il n'y a rien (campagne). */
const around = (p: LatLon, d: number): BBox => [p.lon - d * 1.5, p.lat - d, p.lon + d * 1.5, p.lat + d];

/**
 * Prix de l'énergie pour ce trajet : moyenne des prix officiels du carburant autour du départ, ou
 * tarif réglementé chez soi, ou moyenne des bornes autour du départ. null tant qu'il n'est pas connu.
 */
export function useEnergyPrice(source: EnergySource | null, from: LatLon | null): EnergyPrice {
  // Une demande par zone d'environ 5 km, pas à chaque position GPS.
  const lat = from ? Math.round(from.lat * 20) / 20 : null;
  const lon = from ? Math.round(from.lon * 20) / 20 : null;
  const home = source?.kind === 'electric' && source.at !== 'borne' ? source.at : null;
  const wanted = !source || home ? null : `${source.kind === 'fuel' ? source.fuel : 'borne'}@${lat},${lon}`;
  // Le prix trouvé, avec la demande qui l'a donné : un prix d'une autre demande n'est pas rendu.
  const [found, setFound] = useState<{ key: string; price: EnergyPrice } | null>(null);
  // Après un échec, une nouvelle tentative à chaque nouvel aperçu (le composant est remonté) ou
  // toutes les 30 s tant qu'il reste affiché.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!source || !wanted || lat === null || lon === null) return;
    const ctl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const p = { lat, lon };
    void (async () => {
      for (const d of [0.1, 0.3]) {
        if (source.kind === 'fuel') {
          const day = await getFuelPrice(around(p, d), source.fuel, ctl.signal);
          if (day) return { price: day.avg, where: `moyenne de ${day.stations} station${day.stations > 1 ? 's' : ''} autour de toi` };
        } else {
          const kwh = averageKwh(await getChargeStations(around(p, d), ctl.signal));
          if (kwh !== null) return { price: kwh, where: 'moyenne des bornes autour de toi' };
        }
      }
      return null;
    })().then(
      (price) => setFound({ key: wanted, price }),
      () => {
        if (ctl.signal.aborted) return;
        setFound({ key: wanted, price: 'error' });
        retry = setTimeout(() => setAttempt((n) => n + 1), 30_000);
      },
    );
    return () => {
      ctl.abort();
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, attempt]);

  if (home) return { price: HOME_KWH[home], where: home === 'base' ? 'tarif réglementé EDF' : 'heures creuses EDF' };
  if (!source || (!home && (lat === null || lon === null))) return null;
  return found && found.key === wanted ? found.price : undefined;
}
