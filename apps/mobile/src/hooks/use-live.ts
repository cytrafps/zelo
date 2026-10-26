import { useEffect, useEffectEvent, useState } from 'react';
import { AppState } from 'react-native';

import { LIVE_URL, type LiveEvent, type Report } from '@/api/zelo';

/**
 * Flux temps réel des signalements (WebSocket /v1/live).
 * Reconnexion avec attente exponentielle ; coupé quand l'app passe en arrière-plan
 * (pas de batterie gaspillée) et rouvert au retour. Après chaque reconnexion,
 * `onResync` permet de recharger ce qui a pu être manqué pendant la coupure.
 */
export function useLive(onReport: (r: Report) => void, onResync: () => void) {
  const [connected, setConnected] = useState(false);
  const report = useEffectEvent(onReport);
  const resync = useEffectEvent(onResync);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everOpened = false;
    let active = AppState.currentState !== 'background';

    const connect = () => {
      clearTimeout(timer);
      if (ws || !active) return;
      const socket = new WebSocket(LIVE_URL);
      ws = socket;
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        if (everOpened) resync();
        everOpened = true;
      };
      socket.onmessage = (e) => {
        try {
          const ev = JSON.parse(String(e.data)) as LiveEvent;
          if (ev.type === 'report') report(ev.report);
        } catch {
          // message illisible : ignoré
        }
      };
      socket.onclose = () => {
        if (ws !== socket) return;
        ws = null;
        setConnected(false);
        if (!active) return;
        const delay = Math.min(30_000, 1_000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
        timer = setTimeout(connect, delay);
      };
    };

    const disconnect = () => {
      clearTimeout(timer);
      const socket = ws;
      ws = null;
      socket?.close();
      setConnected(false);
    };

    const sub = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      if (active) connect();
      else if (state === 'background') disconnect();
    });
    connect();
    return () => {
      active = false;
      sub.remove();
      disconnect();
    };
  }, []);

  return connected;
}
