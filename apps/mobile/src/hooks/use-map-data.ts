import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getChargeStations,
  getFuelStations,
  getParkings,
  getReports,
  type BBox,
  type ChargeStation,
  type FuelStation,
  type Parking,
  type Report,
} from '@/api/zelo';
import { contains, fetchArea } from '@/utils/bbox';

export type DataStatus = 'idle' | 'loading' | 'error' | 'zoom-out';
export type Place = 'fuel' | 'charge' | 'parkings';
type Source = Place | 'reports';

type Data = { fuel: FuelStation[]; charge: ChargeStation[]; parkings: Parking[]; reports: Report[] };

const FETCH: { [S in Source]: (b: BBox, signal: AbortSignal) => Promise<Data[S]> } = {
  fuel: getFuelStations,
  charge: getChargeStations,
  parkings: getParkings,
  reports: getReports,
};

const EMPTY: Data = { fuel: [], charge: [], parkings: [], reports: [] };
const notExpired = (now: number) => (r: Report) => new Date(r.expiresAt).getTime() > now;
const inside = ([w, s, e, n]: BBox, r: Report) => r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n;

/**
 * Données de la carte autour de la vue : la catégorie affichée (`place`, aucune pendant un trajet)
 * et les signalements. Chaque source a sa zone chargée : déplacer la carte dans cette zone ne coûte
 * rien, changer de catégorie ne recharge que la nouvelle, et une source en échec n'efface pas les autres.
 *
 * La vue est donnée par `look` (pas par un état React) : la carte qui bouge ne redessine l'écran
 * que lorsqu'il y a vraiment quelque chose à charger.
 */
export function useMapData(place: Place | null) {
  const [data, setData] = useState<Data>(EMPTY);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<Source>>(new Set());
  const [tooWide, setTooWide] = useState(false);
  /** Zone des signalements chargés : le flux temps réel (national) n'y ajoute que ce qu'elle contient. */
  const [reportsArea, setReportsArea] = useState<BBox | null>(null);

  const view = useRef<BBox | null>(null);
  const loaded = useRef<Partial<Record<Source, BBox>>>({});
  const requests = useRef<Partial<Record<Source, AbortController>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(
    (source: Source, area: BBox) => {
      requests.current[source]?.abort();
      const ctl = new AbortController();
      requests.current[source] = ctl;
      setPending((n) => n + 1);
      FETCH[source](area, ctl.signal)
        .then((items) => {
          loaded.current[source] = area;
          setData((d) => ({ ...d, [source]: items }));
          if (source === 'reports') setReportsArea(area);
          setFailed((f) => (f.has(source) ? new Set([...f].filter((x) => x !== source)) : f));
        })
        .catch(() => {
          if (!ctl.signal.aborted) setFailed((f) => new Set(f).add(source));
        })
        .finally(() => setPending((n) => n - 1));
    },
    [],
  );

  /** Charge ce qui manque pour la vue courante, et seulement ça. */
  const sync = useCallback(() => {
    const v = view.current;
    if (!v) return;
    const area = fetchArea(v);
    setTooWide(area === null);
    if (!area) return;
    const wanted: Source[] = place ? ['reports', place] : ['reports'];
    for (const s of wanted) {
      const have = loaded.current[s];
      if (!have || !contains(have, v)) load(s, area);
    }
  }, [place, load]);

  /**
   * Nouvelle vue de la carte (à appeler à chaque fin de mouvement) : chargement après 250 ms de
   * calme, ou au plus tard 2 s après le premier mouvement. En guidage, la carte qui suit la voiture
   * bouge sans arrêt : sans ce plafond, les signalements devant elle n'étaient jamais chargés.
   */
  const pendingSince = useRef<number | null>(null);
  const look = useCallback(
    (bounds: BBox) => {
      view.current = bounds;
      clearTimeout(timer.current);
      const now = Date.now();
      pendingSince.current ??= now;
      const run = () => {
        pendingSince.current = null;
        sync();
      };
      if (now - pendingSince.current >= 2000) run();
      else timer.current = setTimeout(run, 250);
    },
    [sync],
  );

  // Catégorie changée, ou fin de trajet : la nouvelle source se charge tout de suite.
  useEffect(() => {
    sync();
  }, [sync]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      Object.values(requests.current).forEach((c) => c?.abort());
    },
    [],
  );

  // Les signalements expirent d'eux-mêmes côté client aussi.
  useEffect(() => {
    const id = setInterval(() => {
      setData((d) => {
        const kept = d.reports.filter(notExpired(Date.now()));
        return kept.length === d.reports.length ? d : { ...d, reports: kept };
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  /** Ajoute ou met à jour (votes, expiration prolongée) un signalement de la zone chargée. */
  const upsertReport = useCallback(
    (r: Report) => {
      setData((d) => {
        const i = d.reports.findIndex((x) => x.id === r.id);
        if (i === -1 && reportsArea && !inside(reportsArea, r)) return d;
        return { ...d, reports: i === -1 ? [...d.reports, r] : d.reports.map((x, j) => (j === i ? r : x)) };
      });
    },
    [reportsArea],
  );

  const removeReport = useCallback((id: number) => {
    setData((d) => ({ ...d, reports: d.reports.filter((x) => x.id !== id) }));
  }, []);

  /** Tout recharger (bouton « Réessayer »). */
  const reload = useCallback(() => {
    loaded.current = {};
    sync();
  }, [sync]);

  /** Après une coupure du flux temps réel : seuls les signalements ont pu être manqués. */
  const reloadReports = useCallback(() => {
    delete loaded.current.reports;
    sync();
  }, [sync]);

  const status: DataStatus = tooWide ? 'zoom-out' : failed.size > 0 ? 'error' : pending > 0 ? 'loading' : 'idle';
  return { ...data, status, look, upsertReport, removeReport, reload, reloadReports };
}
