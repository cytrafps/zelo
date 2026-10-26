import { Storage } from 'expo-sqlite/kv-store';
import { useState } from 'react';

import type { LatLon } from '@/utils/geo';

export type ParkedCar = LatLon & { parkedAt: string };

const KEY = 'zelo.voiture';

function read(): ParkedCar | null {
  try {
    const raw = Storage.getItemSync(KEY);
    return raw ? (JSON.parse(raw) as ParkedCar) : null;
  } catch {
    return null;
  }
}

/**
 * Où est garée la voiture. Stocké uniquement sur le téléphone (SQLite local),
 * jamais envoyé à l'API : c'est une donnée de localisation personnelle.
 */
export function useParkedCar() {
  const [car, setCar] = useState<ParkedCar | null>(read);

  const park = (at: LatLon) => {
    const next = { lat: at.lat, lon: at.lon, parkedAt: new Date().toISOString() };
    Storage.setItemSync(KEY, JSON.stringify(next));
    setCar(next);
  };

  const forget = () => {
    Storage.removeItemSync(KEY);
    setCar(null);
  };

  return { car, park, forget };
}
