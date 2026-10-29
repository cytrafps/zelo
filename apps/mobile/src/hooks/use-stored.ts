import { Storage } from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Les composants qui lisent la même clé se tiennent à jour : un modèle choisi dans la fiche
// voiture apparaît tout de suite dans l'aperçu du trajet.
const listeners = new Map<string, Set<(v: unknown) => void>>();

/** État conservé sur le téléphone (SQLite local) entre deux lancements, partagé entre écrans. */
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  // Écrit après le rendu, pas dans le calcul de l'état (qu'un rendu concurrent peut rejouer).
  const saved = useRef(value);
  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    // Valeur venue d'un autre écran : déjà écrite, on ne la réécrit pas.
    const on = (v: unknown) => {
      saved.current = v as T;
      setValue(v as T);
    };
    set.add(on);
    return () => void set.delete(on);
  }, [key]);
  useEffect(() => {
    if (saved.current === value) return;
    saved.current = value;
    Storage.setItem(key, JSON.stringify(value)).catch(() => {
      // Disque plein ou base indisponible : la valeur reste en mémoire pour cette session.
    });
    for (const on of listeners.get(key) ?? []) on(value);
  }, [key, value]);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next));
  }, []);
  return [value, set] as const;
}
