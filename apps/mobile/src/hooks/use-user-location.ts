import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

export type Position = { lat: number; lon: number };

/**
 * Position de l'utilisateur, au premier plan uniquement (pas de suivi en arrière-plan).
 * La précision « équilibrée » suffit pour signaler et centrer la carte.
 */
export function useUserLocation() {
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [position, setPosition] = useState<Position | null>(null);
  const granted = permission?.granted ?? false;
  const asked = useRef(false);

  // Une seule demande automatique au lancement ; ensuite seulement sur geste (bouton « ma position »).
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!granted) return;
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20 }, (l) =>
      setPosition({ lat: l.coords.latitude, lon: l.coords.longitude }),
    ).then((s) => (cancelled ? s.remove() : (sub = s)));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [granted]);

  /** Position actuelle, en demandant l'autorisation si besoin ; null si refusée. */
  const locate = async (): Promise<Position | null> => {
    if (!granted && !(await requestPermission()).granted) return null;
    if (position) return position;
    const l = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync());
    return { lat: l.coords.latitude, lon: l.coords.longitude };
  };

  return { granted, position, locate };
}
