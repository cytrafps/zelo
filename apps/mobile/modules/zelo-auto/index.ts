import { requireOptionalNativeModule } from 'expo';

// Absent sur iOS et sur le web : Android Auto n'existe que sur Android.
const native = requireOptionalNativeModule<{ setApiUrl(url: string): void }>('ZeloAuto');

/** Donne l'adresse de l'API à l'écran Android Auto, qui tourne en natif, sans JavaScript. */
export const setApiUrl = (url: string) => native?.setApiUrl(url);
