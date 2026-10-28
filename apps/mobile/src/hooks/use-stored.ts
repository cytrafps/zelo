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

/** État conservé sur le téléphone (SQLite local) entre deux lancements. */
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  // Écrit après le rendu, pas dans le calcul de l'état (qu'un rendu concurrent peut rejouer).
  const saved = useRef(value);
  useEffect(() => {
    if (saved.current === value) return;
    saved.current = value;
    void Storage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next));
  }, []);
  return [value, set] as const;
}
