/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sameTarget, targetPoint, targets, needsWalk } from './targets.ts';

const cinema = { lat: 49.2556, lon: 4.0262 };
const p = (id: string, dLat: number, fee: boolean | null = true) => ({ id, name: id, lat: cinema.lat + dLat, lon: cinema.lon, fee });
const b = (id: string, dLat: number, available: number | null) => ({ id, name: id, lat: cinema.lat + dLat, lon: cinema.lon, maxPowerKw: 22, available });

test('targets : deux parkings les plus proches, la borne libre la plus proche, puis la dépose', () => {
  const t = targets(cinema, [p('loin', 0.005), p('erlon', 0.002), p('boulingrin', 0.003, false), p('trop-loin', 0.02)], [
    b('occupee', 0.001, 0),
    b('erlon', 0.002, 2),
  ]);
  assert.deepEqual(
    t.map((x) => (x.kind === 'dropoff' ? 'dropoff' : `${x.kind}:${x.item.id}`)),
    ['parking:erlon', 'parking:boulingrin', 'charge:erlon', 'dropoff'],
  );
  assert.ok(t[0].kind === 'parking' && t[0].walk > 200 && t[0].walk < 250);
});

test('targets : sans parking à moins de 800 m, seule la dépose reste', () => {
  assert.deepEqual(targets(cinema, [p('trop-loin', 0.02)], [b('inconnue', 0.001, null)]), [{ kind: 'dropoff' }]);
});

test('targetPoint et sameTarget', () => {
  const [erlon, , dropoff] = targets(cinema, [p('erlon', 0.002), p('autre', 0.004)], []);
  assert.deepEqual(targetPoint(dropoff, cinema), cinema);
  assert.equal(targetPoint(erlon, cinema).lat, cinema.lat + 0.002);
  assert.ok(sameTarget(erlon, { ...erlon }) && !sameTarget(erlon, dropoff));
});

test("needsWalk : pas de trajet à pied quand on se gare à destination", () => {
  const p = { id: 'p', name: 'Erlon', fee: true, lat: 49.25, lon: 4.03 };
  assert.equal(needsWalk({ kind: 'parking', item: p, walk: 0 }), false);
  assert.equal(needsWalk({ kind: 'parking', item: p, walk: 210 }), true);
  assert.equal(needsWalk({ kind: 'dropoff' }), false);
});
