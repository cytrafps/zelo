import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { course } from '@/utils/geo';

export type Position = { lat: number; lon: number };

/** Au-delà, le cap mesuré ne dit plus rien de la direction actuelle. */
const HEADING_TTL_MS = 10_000;

/**
 * Position de l'utilisateur, au premier plan uniquement (pas de suivi en arrière-plan).
 * La précision « équilibrée » suffit pour signaler et centrer la carte.
 */
export function useUserLocation() {
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [position, setPosition] = useState<Position | null>(null);
  const lastCourse = useRef<{ heading: number | null; at: number }>({ heading: null, at: 0 });
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
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20 }, (l) => {
      lastCourse.current = { heading: course(l.coords), at: l.timestamp };
      setPosition({ lat: l.coords.latitude, lon: l.coords.longitude });
    }).then((s) => (cancelled ? s.remove() : (sub = s)));
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

  /** Cap de déplacement si l'on roule en ce moment, sinon null (voir `course`). */
  const heading = () => (Date.now() - lastCourse.current.at < HEADING_TTL_MS ? lastCourse.current.heading : null);

  return { granted, position, locate, heading };
}
