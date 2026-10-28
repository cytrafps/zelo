import { useEffect, useEffectEvent, useRef } from 'react';
import { AppState } from 'react-native';

import { ApiError, postReport, type Report, type ReportKind } from '@/api/zelo';
import { useStored } from '@/hooks/use-stored';
import { enqueue, MAX_AGE_MS, nextAttempt, retryLater, split, type Pending } from '@/utils/outbox';

/**
 * Envoi des signalements, même sans réseau : un envoi qui échoue faute de connexion est gardé sur
 * le téléphone et réessayé, de plus en plus espacé, puis abandonné au bout de 15 min. Un refus
 * de l'API (ApiError) n'est pas réessayé : il est renvoyé à l'appelant.
 */
export function useOutbox(onSent: (r: Report) => void) {
  const [queue, setQueue] = useStored<Pending<ReportKind>[]>('zelo.signalements-en-attente', []);
  const flushing = useRef(false);
  const sent = useEffectEvent(onSent);

  const flush = useEffectEvent(async () => {
    if (flushing.current || queue.length === 0) return;
    flushing.current = true;
    const { due } = split(queue, Date.now());
    const later: Pending<ReportKind>[] = [];
    for (const p of due) {
      try {
        sent(await postReport(p.kind, p.lat, p.lon));
      } catch (e) {
        if (!(e instanceof ApiError)) later.push(retryLater(p, Date.now()));
      }
    }
    const now = Date.now();
    setQueue((cur) => [...cur.filter((p) => !due.includes(p) && now - p.at < MAX_AGE_MS), ...later]);
    flushing.current = false;
  });

  useEffect(() => {
    const at = nextAttempt(queue);
    if (at === null) return;
    const timer = setTimeout(() => void flush(), Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [queue]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void flush());
    return () => sub.remove();
  }, []);

  /** Le signalement créé, ou null s'il attend le réseau. */
  const send = async (kind: ReportKind, lat: number, lon: number): Promise<Report | null> => {
    try {
      return await postReport(kind, lat, lon);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      setQueue((q) => enqueue(q, { kind, lat, lon }, Date.now()));
      return null;
    }
  };

  return { send, pending: queue.length };
}
