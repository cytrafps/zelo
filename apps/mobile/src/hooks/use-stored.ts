import { Storage } from 'expo-sqlite/kv-store';
import { useCallback, useState } from 'react';

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
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        Storage.setItemSync(key, JSON.stringify(v));
        return v;
      });
    },
    [key],
  );
  return [value, set] as const;
}
