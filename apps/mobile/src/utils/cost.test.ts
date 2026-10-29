/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { averageKwh, energyUsed, formatCost, fuelLabel, tripCost } from './cost.ts';

test('coût du trajet', () => {
  // 230 km à 6,5 L/100 km et 1,729 €/L : 14,95 L, 25,85 €.
  assert.ok(Math.abs(energyUsed(6.5, 230_000) - 14.95) < 1e-9);
  assert.ok(Math.abs(tripCost(6.5, 1.729, 230_000) - 25.849) < 0.001);
  // 52 km en électrique à 16,3 kWh/100 km et 0,2001 €/kWh : 1,70 €.
  assert.ok(Math.abs(tripCost(16.3, 0.2001, 52_000) - 1.696) < 0.001);
});

test('affichage, seul ou à plusieurs', () => {
  assert.equal(formatCost(25.849), '≈ 25,85 €');
  assert.equal(formatCost(25.849, 3), '≈ 25,85 € · 8,62 €/pers.');
  assert.equal(formatCost(0.04), '< 0,10 €');
  assert.equal(fuelLabel('E10'), 'SP95-E10');
});

test('prix moyen en borne : prix fermes seulement', () => {
  const s = (kwh: number, from = false, free = false) => ({ price: { kwh, from, free } });
  assert.equal(averageKwh([s(0.5), s(0.3, true), s(0, false, true), { price: null }, s(0.4)]), 0.45);
  assert.equal(averageKwh([s(0.3, true)]), null);
});
