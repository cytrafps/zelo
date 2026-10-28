/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { course, distance, formatDistance, nearest, rankByProximity, walkingMinutes } from './geo.ts';

const cathedrale = { lat: 49.2535, lon: 4.0341 };
const gare = { lat: 49.2591, lon: 4.0245 };

test('distance : Cathédrale – gare de Reims ≈ 960 m', () => {
  const d = distance(cathedrale, gare);
  assert.ok(d > 900 && d < 1020, `${d}`);
  assert.equal(distance(gare, gare), 0);
  assert.equal(Math.round(distance(cathedrale, gare)), Math.round(distance(gare, cathedrale)));
});

test('nearest trie par distance et limite', () => {
  const items = [
    { id: 'loin', lat: 49.3, lon: 4.1 },
    { id: 'pres', lat: 49.2536, lon: 4.0342 },
    { id: 'moyen', lat: 49.258, lon: 4.03 },
  ];
  const got = nearest(items, cathedrale, 2);
  assert.deepEqual(got.map((x) => x.item.id), ['pres', 'moyen']);
  assert.ok(got[0].meters < got[1].meters);
});

test('formatDistance', () => {
  assert.equal(formatDistance(3), '10 m');
  assert.equal(formatDistance(347), '350 m');
  assert.equal(formatDistance(994), '990 m');
  assert.equal(formatDistance(996), '1 km');
  assert.equal(formatDistance(1234), '1,2 km');
  assert.equal(formatDistance(12_400), '12 km');
});

test('walkingMinutes', () => {
  assert.equal(walkingMinutes(0), 1);
  assert.equal(walkingMinutes(750), 13);
});

test('rankByProximity favorise le proche à pertinence voisine, pas l’introuvable', () => {
  const reims = { lat: 49.2583, lon: 4.0317 };
  const items: { id: string; score: number; lat: number; lon: number; municipality?: boolean }[] = [
    { id: 'homonyme à 39 km', score: 0.91, lat: 49.17, lon: 4.42 },
    { id: 'rue à Reims', score: 0.74, lat: 49.2556, lon: 4.0228 },
    { id: 'hors sujet proche', score: 0.3, lat: 49.258, lon: 4.031 },
    { id: 'commune à 25 km', score: 0.94, lat: 49.04, lon: 3.96, municipality: true },
    { id: 'lieu proche citant la commune', score: 0.78, lat: 49.255, lon: 4.03 },
  ];
  const got = rankByProximity(items, reims, 4).map((x) => x.id);
  assert.deepEqual(got, ['commune à 25 km', 'lieu proche citant la commune', 'rue à Reims', 'homonyme à 39 km']);
});

test("course : le cap GPS seulement quand on roule", () => {
  assert.equal(course({ heading: 87, speed: 12 }), 87);
  assert.equal(course({ heading: 87, speed: 1.2 }), null); // à pied ou à l'arrêt
  assert.equal(course({ heading: -1, speed: 12 }), null); // Android : cap inconnu
  assert.equal(course({ heading: null, speed: null }), null);
});
