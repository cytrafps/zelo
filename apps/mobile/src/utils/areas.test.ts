import assert from 'node:assert/strict';
import { test } from 'node:test';

import { areaCharge, areaFuel, areaName, areaServices, nextArea } from './areas.ts';
import type { Area } from './route.ts';

const aire = (over: Partial<Area> = {}): Area => ({
  id: 'way/1',
  kind: 'services',
  name: 'Aire de Reims Champagne-Sud',
  lat: 49.12,
  lon: 4.24,
  services: ['restauration', 'douches', 'camping-car'],
  along: 24_000,
  ...over,
});

test('areaServices et areaName', () => {
  assert.equal(areaServices(aire()), 'Restauration · Douches · Camping-car');
  assert.equal(areaName(aire({ name: '' })), 'Aire de service');
  assert.equal(areaName(aire({ name: '', kind: 'rest_area' })), 'Aire de repos');
});

test('areaFuel : les deux carburants les plus courants, 2 décimales', () => {
  assert.equal(areaFuel(aire({ fuel: { SP98: 1.999, Gazole: 1.759, E10: 1.849 } })), 'Gazole 1,76 € · E10 1,85 €');
  assert.equal(areaFuel(aire()), '');
});

test('areaCharge', () => {
  assert.equal(areaCharge(aire({ charge: { total: 4, available: 3 } })), '3/4 bornes libres');
  assert.equal(areaCharge(aire({ charge: { total: 1, available: 0 } })), '0/1 borne libre');
  assert.equal(areaCharge(aire({ charge: { total: 6, available: null } })), '6 bornes');
  assert.equal(areaCharge(aire()), '');
});

test('nextArea : la première devant soi, à moins de 50 km', () => {
  const areas = [aire({ id: 'a', along: 10_000 }), aire({ id: 'b', along: 70_000 })];
  assert.equal(nextArea(areas, 0)?.id, 'a');
  assert.equal(nextArea(areas, 12_000), undefined); // la suivante est à 58 km
  assert.equal(nextArea(areas, 30_000)?.id, 'b');
  assert.equal(nextArea(undefined, 0), undefined);
});
