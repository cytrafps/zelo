/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { carAction, carActions } from './car-events.ts';

const at = Date.parse('2026-10-28T18:00:00Z');

test('déconnexion avec une position récente et précise : la voiture est garée là', () => {
  assert.deepEqual(carAction({ kind: 'parked', at, lat: 49.25, lon: 4.03, accuracy: 12, fixAt: at - 20_000 }, null), {
    kind: 'park',
    at: { lat: 49.25, lon: 4.03 },
  });
});

test('déconnexion sans position fiable : on demande', () => {
  assert.deepEqual(carAction({ kind: 'parked', at }, null), { kind: 'ask' });
  assert.deepEqual(carAction({ kind: 'parked', at, lat: 49.25, lon: 4.03, accuracy: 300, fixAt: at }, null), { kind: 'ask' });
  assert.deepEqual(carAction({ kind: 'parked', at, lat: 49.25, lon: 4.03, accuracy: 10, fixAt: at - 10 * 60_000 }, null), {
    kind: 'ask',
  });
});

test('reconnexion : la place enregistrée se libère, sauf si elle date d’après', () => {
  const car = { lat: 49.25, lon: 4.03, parkedAt: '2026-10-28T12:00:00Z' };
  assert.deepEqual(carAction({ kind: 'departed', at }, car), { kind: 'freed', at: { lat: 49.25, lon: 4.03 }, since: at });
  assert.equal(carAction({ kind: 'departed', at }, null), null);
  assert.equal(carAction({ kind: 'departed', at }, { ...car, parkedAt: '2026-10-28T19:00:00Z' }), null);
});

test('carActions : garé en B puis reparti, app fermée : c’est B qui se libère', () => {
  const a = { lat: 49.2, lon: 4.0, parkedAt: '2026-10-28T08:00:00Z' };
  const b = { kind: 'parked' as const, at: at - 60_000, lat: 49.26, lon: 4.04, accuracy: 8, fixAt: at - 70_000, via: 'bluetooth' as const };
  // Lus dans le désordre : rangés par heure.
  assert.deepEqual(carActions([{ kind: 'departed', at }, b], a), [
    { kind: 'park', at: { lat: 49.26, lon: 4.04 }, via: 'bluetooth' },
    { kind: 'freed', at: { lat: 49.26, lon: 4.04 }, since: at },
  ]);
});

test('carActions : après une déconnexion sans position, un départ ne libère pas l’ancienne place', () => {
  const a = { lat: 49.2, lon: 4.0, parkedAt: '2026-10-28T08:00:00Z' };
  assert.deepEqual(carActions([{ kind: 'parked', at: at - 60_000 }, { kind: 'departed', at }], a), [{ kind: 'ask' }]);
});
