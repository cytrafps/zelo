import assert from 'node:assert/strict';
import { test } from 'node:test';

import { laneIcon, maneuverSide } from './maneuver.ts';

test('laneIcon : une voie « tout droit ou à droite » montre la flèche de la manœuvre', () => {
  assert.deepEqual(laneIcon(['straight', 'right'], 'right'), { ios: 'arrow.turn.up.right', android: 'turn_right' });
  assert.deepEqual(laneIcon(['straight', 'right'], 'left'), { ios: 'arrow.up', android: 'straight' });
  assert.deepEqual(laneIcon(['slight left'], 'left'), { ios: 'arrow.up.left', android: 'turn_slight_left' });
  assert.deepEqual(laneIcon([], 'straight'), { ios: 'arrow.up', android: 'straight' });
});

test('maneuverSide : côté des virages, sorties et demi-tours Valhalla', () => {
  assert.equal(maneuverSide(10), 'right');
  assert.equal(maneuverSide(20), 'right');
  assert.equal(maneuverSide(15), 'left');
  assert.equal(maneuverSide(13), 'left');
  assert.equal(maneuverSide(8), 'straight');
});
