/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arrivalPercent, evName, searchModels, type EvModel } from './ev.ts';

const r5: EvModel = { id: 'r5', brand: 'Renault', model: '5 E-Tech', variant: '52kWh 150hp', year: 2025, batteryKwh: 52, kwhPer100km: 16.3, acKw: 11, dcKw: 100, ports: ['ccs', 'type2'] };
const zoe: EvModel = { ...r5, id: 'zoe', model: 'Zoé', variant: 'R135', year: 2020, batteryKwh: 52, kwhPer100km: 17.7 };

test('batterie à l’arrivée', () => {
  // 100 km à 16,3 kWh/100 km sur 52 kWh : 31,3 % de batterie.
  assert.ok(Math.abs(arrivalPercent(r5, 80, 100_000) - (80 - 31.35)) < 0.01);
  // Par grand froid, 20 % de plus.
  assert.ok(arrivalPercent(r5, 80, 100_000, true) < arrivalPercent(r5, 80, 100_000));
  assert.ok(arrivalPercent(r5, 20, 300_000) < 0, 'n’y arrive pas');
});

test('recherche : tous les mots, sans accents, récents d’abord', () => {
  assert.deepEqual(searchModels([zoe, r5], 'renault').map((m) => m.id), ['r5', 'zoe']);
  assert.deepEqual(searchModels([zoe, r5], 'zoe r135').map((m) => m.id), ['zoe']);
  assert.deepEqual(searchModels([zoe, r5], '  '), []);
  assert.equal(evName(r5), 'Renault 5 E-Tech 52kWh 150hp 2025');
});
