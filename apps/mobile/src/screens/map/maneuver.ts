import type { SymbolViewProps } from 'expo-symbols';

type Icon = SymbolViewProps['name'];

const STRAIGHT: Icon = { ios: 'arrow.up', android: 'straight' };
const RIGHT: Icon = { ios: 'arrow.turn.up.right', android: 'turn_right' };
const LEFT: Icon = { ios: 'arrow.turn.up.left', android: 'turn_left' };
const SLIGHT_RIGHT: Icon = { ios: 'arrow.up.right', android: 'turn_slight_right' };
const SLIGHT_LEFT: Icon = { ios: 'arrow.up.left', android: 'turn_slight_left' };
const ARRIVE: Icon = { ios: 'mappin.circle.fill', android: 'flag' };

/**
 * Flèche d'une voie : celle qui sert la manœuvre si la voie en porte plusieurs
 * (« tout droit ou à droite » montrée « à droite » quand on tourne à droite).
 */
export function laneIcon(directions: readonly string[], toward: 'left' | 'right' | 'straight'): Icon {
  const d = directions.find((x) => x.includes(toward)) ?? directions[0] ?? 'straight';
  if (d === 'uturn') return { ios: 'arrow.uturn.left', android: 'u_turn_left' };
  if (d === 'slight right') return SLIGHT_RIGHT;
  if (d === 'slight left') return SLIGHT_LEFT;
  if (d.includes('right')) return RIGHT;
  if (d.includes('left')) return LEFT;
  return STRAIGHT;
}

/** Côté d'une manœuvre Valhalla, pour choisir la flèche des voies. */
export function maneuverSide(type: number): 'left' | 'right' | 'straight' {
  if ([2, 9, 10, 11, 12, 18, 20, 23, 37].includes(type)) return 'right';
  if ([3, 13, 14, 15, 16, 19, 21, 24, 38].includes(type)) return 'left';
  return 'straight';
}

/** Icône d'une manœuvre Valhalla (types de valhalla/odin/maneuver.h). */
export function maneuverIcon(type: number): Icon {
  switch (type) {
    case 4:
    case 5:
    case 6:
      return ARRIVE;
    case 9:
    case 18:
    case 20:
    case 23:
      return SLIGHT_RIGHT;
    case 2:
    case 10:
    case 11:
      return RIGHT;
    case 16:
    case 19:
    case 21:
    case 24:
      return SLIGHT_LEFT;
    case 3:
    case 14:
    case 15:
      return LEFT;
    case 12:
      return { ios: 'arrow.uturn.right', android: 'u_turn_right' };
    case 13:
      return { ios: 'arrow.uturn.left', android: 'u_turn_left' };
    case 26:
    case 27:
      return { ios: 'arrow.triangle.turn.up.right.circle', android: 'roundabout_right' };
    case 25:
    case 37:
    case 38:
      return { ios: 'arrow.merge', android: 'merge' };
    default:
      return STRAIGHT;
  }
}
