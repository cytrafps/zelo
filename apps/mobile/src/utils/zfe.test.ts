/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { critairLabel, refused, zoneAt, type Zone } from './zfe.ts';

// Carré autour du centre de Reims, avec un trou (une voie exclue).
const reims: Zone = {
  id: 'reims',
  name: 'ZFE du Grand Reims',
  from: '2023-01-01',
  to: '2028-12-31',
  car: { banned: 'V4', hours: '24/7' },
  polygons: [
    [
      [[4.0, 49.24], [4.06, 49.24], [4.06, 49.28], [4.0, 49.28], [4.0, 49.24]],
      [[4.02, 49.25], [4.03, 49.25], [4.03, 49.26], [4.02, 49.26], [4.02, 49.25]],
    ],
  ],
};
const old: Zone = { ...reims, id: 'ancienne', from: '2022-01-01', to: '2022-12-31', car: { banned: 'V5' } };

test('zone en vigueur qui contient le point', () => {
  const cathedrale = { lat: 49.2535, lon: 4.0341 };
  assert.equal(zoneAt([old, reims], cathedrale, '2026-10-28')?.id, 'reims');
  assert.equal(zoneAt([old, reims], cathedrale, '2022-06-01')?.id, 'ancienne');
  assert.equal(zoneAt([reims], cathedrale, '2029-01-01'), undefined);
  assert.equal(zoneAt([reims], { lat: 49.255, lon: 4.025 }, '2026-10-28'), undefined, 'dans le trou');
  assert.equal(zoneAt([reims], { lat: 49.3, lon: 4.03 }, '2026-10-28'), undefined, 'hors zone');
});

test('vignettes refusées : « V4 » refuse Crit’Air 4, 5 et sans vignette', () => {
  const rule = reims.car!;
  assert.deepEqual(
    (['EL', 'V1', 'V2', 'V3', 'V4', 'V5', 'NC'] as const).filter((v) => refused(v, rule)),
    ['V4', 'V5', 'NC'],
  );
  assert.equal(critairLabel('V3'), "Crit'Air 3");
  assert.equal(critairLabel('EL'), 'électrique');
});
