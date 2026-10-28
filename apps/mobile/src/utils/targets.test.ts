/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { forVehicle, sameTarget, targetPoint, targets, needsWalk } from './targets.ts';

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

test('forVehicle : arceaux à vélo, places motos en tête à moto, parkings voiture sinon', () => {
  const car = p('erlon', 0.002);
  const rack = { ...p('arceaux', 0.0005), vehicle: 'bike' as const };
  const moto = { ...p('motos', 0.001), vehicle: 'moto' as const };
  const far = { ...p('arceaux-loin', 0.004), vehicle: 'bike' as const }; // 440 m : trop loin à vélo
  const deux = { ...b('deux-roues', 0.001, 2), twoWheels: true };
  const t = targets(cinema, [car, rack, moto, far], [b('auto', 0.001, 2), deux]);
  const ids = (v: 'car' | 'moto' | 'bike') => forVehicle(t, v).map((x) => (x.kind === 'dropoff' ? 'dropoff' : `${x.kind}:${x.item.id}`));
  assert.deepEqual(ids('bike'), ['parking:arceaux', 'dropoff']);
  // À moto, la borne deux-roues plutôt que la plus proche.
  assert.deepEqual(ids('moto'), ['parking:motos', 'parking:erlon', 'charge:deux-roues', 'dropoff']);
  assert.ok(!ids('car').includes('parking:arceaux') && !ids('car').includes('parking:motos'));
});
