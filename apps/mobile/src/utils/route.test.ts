/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { along, bounds, cumulative, formatClock, formatDuration, pointAt, progress, type Route } from './route.ts';

// Vraie réponse de GET /v1/route : gare de Reims → cathédrale, 1 875 m.
const route: Route = JSON.parse(readFileSync(new URL('./testdata/gare-cathedrale.json', import.meta.url), 'utf8'));
const cum = cumulative(route.coordinates);
const at = (i: number) => ({ lon: route.coordinates[i][0], lat: route.coordinates[i][1] });

test('cumulative : la longueur du tracé recoupe la distance de Valhalla', () => {
  const total = cum[cum.length - 1];
  assert.ok(Math.abs(total - route.distance) / route.distance < 0.03, `${total} m`);
});

test('progress : au départ, tout reste à faire et la prochaine manœuvre est Boulevard Joffre', () => {
  const p = progress(route, cum, at(0));
  assert.ok(p.offRoute < 1);
  assert.ok(Math.abs(p.remaining - cum[cum.length - 1]) < 1);
  assert.equal(route.steps[p.next].street, 'Boulevard Joffre');
  assert.ok(Math.abs(p.toNext - cum[route.steps[p.next].shape]) < 1);
});

test('progress : à mi-parcours, le temps restant diminue au prorata', () => {
  const mid = route.steps[5].shape;
  const p = progress(route, cum, at(mid));
  assert.ok(p.remaining < route.distance && p.remaining > 0);
  assert.ok(Math.abs(p.remainingTime / route.duration - p.remaining / cum[cum.length - 1]) < 0.01);
  assert.ok(p.next >= 5);
});

test("progress : à l'arrivée, la prochaine manœuvre est la dernière", () => {
  const p = progress(route, cum, at(route.coordinates.length - 1));
  assert.ok(p.remaining < 1);
  assert.equal(p.next, route.steps.length - 1);
});

test('progress : à 300 m au nord du tracé, on est hors itinéraire', () => {
  const [w, , e, n] = bounds(route.coordinates);
  const p = progress(route, cum, { lat: n + 0.0027, lon: (w + e) / 2 });
  assert.ok(p.offRoute > 280 && p.offRoute < 600, `${p.offRoute}`);
});

test('along : un signalement sur le trajet est gardé avec sa rue, un autre à 300 m est ignoré', () => {
  const onRoute = { id: 1, ...at(10) };
  const far = { id: 2, lat: at(10).lat + 0.003, lon: at(10).lon };
  const found = along(route, cum, [onRoute, far]);
  assert.equal(found.length, 1);
  assert.equal(found[0].item.id, 1);
  assert.equal(found[0].street, 'Boulevard Joffre');
});

test('formatDuration et formatClock', () => {
  assert.equal(formatDuration(449), '8 min');
  assert.equal(formatDuration(20), '1 min');
  assert.equal(formatDuration(3900), '1 h 05');
  assert.equal(formatClock(new Date(2026, 9, 27, 20, 8)), '20 h 08');
});

test('bounds et pointAt', () => {
  const [w, s, e, n] = bounds(route.coordinates);
  assert.ok(w < e && s < n);
  const mid = pointAt(route.coordinates, cum, 0.5);
  assert.ok(mid[0] >= w && mid[0] <= e && mid[1] >= s && mid[1] <= n);
});
