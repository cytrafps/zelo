import { Images } from '@maplibre/maplibre-react-native';
import type { SymbolViewProps } from 'expo-symbols';
import { Platform } from 'react-native';

export type Category = 'carburant' | 'recharge' | 'stationnement';

/** À partir de ce zoom, les ronds deviennent les pastilles des maquettes (icône + valeur). */
export const PIN_MIN_ZOOM = 14.5;

export const CATEGORY_ICON: Record<Category, SymbolViewProps['name']> = {
  carburant: { ios: 'fuelpump.fill', android: 'local_gas_station' },
  recharge: { ios: 'ev.charger.fill', android: 'ev_station' },
  stationnement: { ios: 'parkingsign', android: 'local_parking' },
};

/**
 * Pastilles dessinées par la carte elle-même (couche « symbol »), pas par des vues React :
 * le moteur natif les place et les déclutte à chaque image, sans passer par JavaScript.
 * Une image par forme et par thème ; la valeur (prix, places libres) est un texte de la couche.
 */
const LIGHT = {
  'pin-parking': require('../../../assets/map/pin-parking-light.png'),
  'pin-fuel': require('../../../assets/map/pin-fuel-light.png'),
  'pin-fuel-icon': require('../../../assets/map/pin-fuel-icon-light.png'),
  'pin-ev': require('../../../assets/map/pin-ev-light.png'),
  'pin-ev-s': require('../../../assets/map/pin-ev-s-light.png'),
  'pin-ev-l': require('../../../assets/map/pin-ev-l-light.png'),
  'pin-ev-s-off': require('../../../assets/map/pin-ev-s-off-light.png'),
  'pin-ev-l-off': require('../../../assets/map/pin-ev-l-off-light.png'),
};

const DARK: typeof LIGHT = {
  'pin-parking': require('../../../assets/map/pin-parking-dark.png'),
  'pin-fuel': require('../../../assets/map/pin-fuel-dark.png'),
  'pin-fuel-icon': require('../../../assets/map/pin-fuel-icon-dark.png'),
  'pin-ev': require('../../../assets/map/pin-ev-dark.png'),
  'pin-ev-s': require('../../../assets/map/pin-ev-s-dark.png'),
  'pin-ev-l': require('../../../assets/map/pin-ev-l-dark.png'),
  'pin-ev-s-off': require('../../../assets/map/pin-ev-s-off-dark.png'),
  'pin-ev-l-off': require('../../../assets/map/pin-ev-l-off-dark.png'),
};

/** Panneaux sur le tracé et flèche du guidage : les mêmes en clair et en sombre (bordés de blanc). */
const CONTROLS = {
  'control-feu': require('../../../assets/map/control-feu.png'),
  'control-stop': require('../../../assets/map/control-stop.png'),
  'control-cédez': require('../../../assets/map/control-cedez.png'),
  'puck-arrow': Platform.OS === 'ios' ? require('../../../assets/map/puck-arrow-ios.png') : require('../../../assets/map/puck-arrow-android.png'),
};

export type PinImage = keyof typeof LIGHT;

const LIGHT_ALL = { ...LIGHT, ...CONTROLS };
const DARK_ALL = { ...DARK, ...CONTROLS };

export function PinImages({ dark }: { dark: boolean }) {
  return <Images images={dark ? DARK_ALL : LIGHT_ALL} />;
}

/**
 * Le texte commence juste après la tuile de couleur, à 34 px du bord gauche de la pastille :
 * décalage en em (police de 15 px) depuis le centre de l'image, selon la largeur de la pastille.
 */
const offset = (width: number): [number, number] => [(34 - width / 2) / 15, 0];

/** Expression de la couche : décalage du texte selon l'image de la pastille. */
export const TEXT_OFFSET = [
  'match',
  ['get', 'pin'],
  'pin-fuel',
  ['literal', offset(74)],
  ['pin-ev-s', 'pin-ev-s-off'],
  ['literal', offset(68)],
  ['pin-ev-l', 'pin-ev-l-off'],
  ['literal', offset(84)],
  ['literal', [0, 0]],
];

/** Pastille d'une station : avec le prix, ou l'icône seule s'il n'est pas publié. */
export const fuelPin = (label: string): PinImage => (label ? 'pin-fuel' : 'pin-fuel-icon');

/** Pastille d'une borne : icône seule sans état publié, grise si aucun point n'est libre. */
export function chargePin(label: string, free: boolean): PinImage {
  if (!label) return 'pin-ev';
  return `pin-ev-${label.length > 3 ? 'l' : 's'}${free ? '' : '-off'}`;
}
