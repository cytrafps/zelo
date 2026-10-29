import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

import { onCarEvent, takeCarEvents } from '../../modules/zelo-auto';
import type { ParkedCar } from '@/hooks/use-parked-car';
import { carActions, type CarAction } from '@/utils/car-events';

/**
 * Connexions à Android Auto ou au Bluetooth de la voiture notées par le module natif : lues à l'ouverture de l'app, à chaque
 * retour au premier plan, et aussitôt si l'app tourne déjà. Sans effet hors Android.
 */
export function useCarEvents(car: ParkedCar | null, onAction: (a: CarAction) => void) {
  const handle = useEffectEvent(() => {
    for (const a of carActions(takeCarEvents(), car)) onAction(a);
  });
  useEffect(() => {
    handle();
    const app = AppState.addEventListener('change', (s) => s === 'active' && handle());
    const native = onCarEvent(() => handle());
    return () => {
      app.remove();
      native?.remove();
    };
  }, []);
}
