import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getChargeStations,
  getFuelStations,
  getReports,
  type BBox,
  type ChargeStation,
  type FuelStation,
  type Report,
} from '@/api/zelo';
import { contains, fetchArea } from '@/utils/bbox';

export type DataStatus = 'idle' | 'loading' | 'error' | 'zoom-out';

const notExpired = (now: number) => (r: Report) => new Date(r.expiresAt).getTime() > now;

/**
 * Stations, bornes et signalements autour de la vue visible.
 * Une seule requête par source tant que la vue reste dans la zone déjà chargée ;
 * la requête précédente est annulée si la carte bouge encore.
 */
export function useMapData(view: BBox | null) {
  const [fuel, setFuel] = useState<FuelStation[]>([]);
  const [charge, setCharge] = useState<ChargeStation[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<DataStatus>('idle');
  const [reloadToken, setReloadToken] = useState(0);
  const loaded = useRef<BBox | null>(null);

  useEffect(() => {
    if (!view || (loaded.current && contains(loaded.current, view))) return;
    const area = fetchArea(view);
    if (!area) return; // trop dézoomé : voir `tooWide` plus bas
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setStatus('loading');
      try {
        const [f, c, r] = await Promise.all([
          getFuelStations(area, ctl.signal),
          getChargeStations(area, ctl.signal),
          getReports(area, ctl.signal),
        ]);
        loaded.current = area;
        setFuel(f);
        setCharge(c);
        setReports(r);
        setStatus('idle');
      } catch {
        if (!ctl.signal.aborted) setStatus('error');
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [view, reloadToken]);

  // Les signalements expirent d'eux-mêmes côté client aussi.
  useEffect(() => {
    const id = setInterval(() => {
      setReports((list) => {
        const kept = list.filter(notExpired(Date.now()));
        return kept.length === list.length ? list : kept;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const addReport = useCallback((r: Report) => {
    setReports((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]));
  }, []);

  const reload = useCallback(() => {
    loaded.current = null;
    setReloadToken((n) => n + 1);
  }, []);

  const tooWide = view !== null && fetchArea(view) === null;
  return { fuel, charge, reports, status: tooWide ? ('zoom-out' as const) : status, addReport, reload };
}
