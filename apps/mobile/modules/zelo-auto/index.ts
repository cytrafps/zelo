import { requireOptionalNativeModule, type EventSubscription } from 'expo';

/** Événement noté à la connexion ou à la déconnexion d'Android Auto (horodatages en ms). */
export type CarEvent =
  | { kind: 'parked'; at: number; lat?: number; lon?: number; accuracy?: number; fixAt?: number }
  | { kind: 'departed'; at: number };

type Native = {
  setApiUrl(url: string): void;
  takeCarEvent(): CarEvent | null;
  addListener(event: 'onCarEvent', listener: (e: CarEvent) => void): EventSubscription;
};

// Absent sur iOS et sur le web : Android Auto n'existe que sur Android.
const native = requireOptionalNativeModule<Native>('ZeloAuto');

/** Donne l'adresse de l'API à l'écran Android Auto, qui tourne en natif, sans JavaScript. */
export const setApiUrl = (url: string) => native?.setApiUrl(url);

/** Dernier événement Android Auto pas encore lu (il est effacé), ou null. */
export const takeCarEvent = (): CarEvent | null => native?.takeCarEvent() ?? null;

/** Prévient à chaque connexion ou déconnexion pendant que l'app tourne. */
export const onCarEvent = (listener: (e: CarEvent) => void) => native?.addListener('onCarEvent', listener);
