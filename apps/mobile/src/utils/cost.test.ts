/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cheapestRoute, routeCost, averageKwh, energyUsed, formatCost, fuelLabel, tripCost } from './cost.ts';

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

test('coût de l’itinéraire : énergie et péage', () => {
  assert.equal(routeCost(null, undefined), null);
  assert.deepEqual(routeCost(null, { price: 2.8, complete: true }), { total: null, text: '2,80 € de péage' });
  assert.deepEqual(routeCost(10, { price: 2.8, complete: true }, 2), { total: 12.8, text: '≈ 12,80 € · 6,40 €/pers. dont 2,80 € de péage' });
  assert.deepEqual(routeCost(10, { price: 2.8, complete: false }), { total: null, text: '≈ 12,80 € dont au moins 2,80 € de péage' });
  assert.deepEqual(routeCost(10, { price: 0, complete: false }), { total: null, text: '≈ 10,00 € + péage non chiffré' });
  assert.deepEqual(routeCost(null, { price: 0, complete: false }), { total: null, text: 'péage non chiffré' });
  assert.deepEqual(routeCost(10, undefined), { total: 10, text: '≈ 10,00 €' });
});

test('le moins cher : tout chiffré, au moins 50 centimes d’écart', () => {
  assert.equal(cheapestRoute([12.8, 10]), 1);
  assert.equal(cheapestRoute([10.2, 10]), -1);
  assert.equal(cheapestRoute([10, null]), -1);
  assert.equal(cheapestRoute([10]), -1);
  assert.equal(cheapestRoute([]), -1);
});
