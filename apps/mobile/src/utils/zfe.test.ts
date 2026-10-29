/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { critairLabel, paris, refused, ruleActive, zoneAt, zoneCrossed, type Zone } from './zfe.ts';

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

test("paris : heure de Paris quel que soit le fuseau du téléphone, été comme hiver", () => {
  assert.deepEqual(paris(Date.parse('2026-10-29T23:30:00Z')), { day: '2026-10-30', weekday: 5, minutes: 30 }); // hiver, +1
  assert.deepEqual(paris(Date.parse('2026-07-01T22:30:00Z')), { day: '2026-07-02', weekday: 4, minutes: 30 }); // été, +2
  // Changements d'heure 2026 : 29 mars et 25 octobre, à 1 h UTC.
  assert.equal(paris(Date.parse('2026-03-29T00:59:00Z')).minutes, 1 * 60 + 59);
  assert.equal(paris(Date.parse('2026-03-29T01:00:00Z')).minutes, 3 * 60);
  assert.equal(paris(Date.parse('2026-10-25T00:59:00Z')).minutes, 2 * 60 + 59);
  assert.equal(paris(Date.parse('2026-10-25T01:00:00Z')).minutes, 2 * 60);
});

test('ruleActive : horaires opening_hours, ou null si le format est inconnu', () => {
  const at = (iso: string) => Date.parse(iso); // heures de Paris en hiver (+01:00)
  assert.equal(ruleActive('24/7', at('2026-11-01T03:00:00+01:00')), true);
  assert.equal(ruleActive(undefined, at('2026-11-01T03:00:00+01:00')), true);
  const week = 'Mo-Fr 07:00-20:00';
  assert.equal(ruleActive(week, at('2026-11-02T08:00:00+01:00')), true); // lundi 8 h
  assert.equal(ruleActive(week, at('2026-11-02T20:30:00+01:00')), false); // lundi soir
  assert.equal(ruleActive(week, at('2026-11-01T10:00:00+01:00')), false); // dimanche
  assert.equal(ruleActive('Mo-Fr 07:00-20:00; Sa 08:00-12:00', at('2026-11-07T09:00:00+01:00')), true);
  assert.equal(ruleActive('Fr 22:00-06:00', at('2026-11-07T05:00:00+01:00')), true); // nuit de vendredi à samedi
  assert.equal(ruleActive('Mo-Fr 07:00-20:00 "sauf jours fériés"', at('2026-11-02T08:00:00+01:00')), null);
  assert.equal(ruleActive('PH off', at('2026-11-02T08:00:00+01:00')), null);
});

test('zoneCrossed : un tracé qui traverse la zone, même s’il s’arrête dehors', () => {
  const across: [number, number][] = [[3.98, 49.27], [4.05, 49.27], [4.08, 49.27]];
  const around: [number, number][] = [[3.98, 49.3], [4.08, 49.3]];
  assert.equal(zoneCrossed([reims], across, '2026-10-28')?.id, 'reims');
  assert.equal(zoneCrossed([reims], around, '2026-10-28'), undefined);
});
