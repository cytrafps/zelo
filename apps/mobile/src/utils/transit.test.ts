import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextRide, relayDuration, titleCase } from './transit.ts';

const at = (hhmm: string) => `2026-11-03T${hhmm}:00+01:00`;
const rides = [
  { line: 'TRAM', headsign: 'HOPITAL DEBRE', depart: at('08:05'), arrive: at('08:21'), stops: 10 },
  { line: 'TRAM', headsign: 'GARE CHAMP. TGV', depart: at('08:10'), arrive: at('08:27'), stops: 10 },
];

test("nextRide : le premier tram qu'on peut encore prendre", () => {
  assert.equal(nextRide(rides, Date.parse(at('08:00')))?.depart, at('08:05'));
  assert.equal(nextRide(rides, Date.parse(at('08:06')))?.depart, at('08:10'));
  assert.equal(nextRide(rides, Date.parse(at('08:11'))), undefined);
});

test('relayDuration : marche au quai, attente, tram et marche finale', () => {
  // Garé à 8 h 03, 120 m jusqu'au quai (100 s) : le tram de 8 h 05, arrivée 8 h 21, puis 5 min à pied.
  assert.equal(relayDuration(rides, Date.parse(at('08:03')), 120, 300), 18 * 60 + 300);
  // Garé à 8 h 04 : 8 h 05 est manqué (quai à 8 h 05 min 40), on prend celui de 8 h 10.
  assert.equal(relayDuration(rides, Date.parse(at('08:04')), 120, 0), 23 * 60);
  assert.equal(relayDuration(rides, Date.parse(at('08:30')), 120, 0), null);
});

test('titleCase', () => {
  assert.equal(titleCase('OPERA-CATHEDRALE'), 'Opera-Cathedrale');
  assert.equal(titleCase('GARE CHAMP. TGV'), 'Gare Champ. TGV');
  assert.equal(titleCase("ST THOMAS"), 'St Thomas');
});
