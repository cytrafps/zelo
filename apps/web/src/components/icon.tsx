import type { CSSProperties } from 'react';

import carburant from '../assets/icons/carburant.svg';
import construction from '../assets/icons/construction.svg';
import home from '../assets/icons/home.svg';
import parking from '../assets/icons/parking.svg';
import recharge from '../assets/icons/recharge.svg';
import reglages from '../assets/icons/reglages.svg';
import signalement from '../assets/icons/signalement.svg';
import warning from '../assets/icons/warning.svg';

// Symboles de la maquette (Material Symbols), affichés en masque pour prendre la couleur du texte.
const SRC = { carburant, construction, home, parking, recharge, reglages, signalement, warning };
export type IconName = keyof typeof SRC;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const style = { width: size, height: size, '--src': `url("${SRC[name]}")` } as CSSProperties;
  return <span className="icone" style={style} aria-hidden="true" />;
}
