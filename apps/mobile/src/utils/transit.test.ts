import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Journey } from '../api/zelo.ts';
import { linesLabel, nextJourney, relayDuration, stopName, titleCase } from './transit.ts';

const at = (hhmm: string) => `2026-11-03T${hhmm}:00+01:00`;
const stop = (name: string) => ({ id: name, name, lat: 49.25, lon: 4.03 });
const tram = { id: 'TRAM', name: 'TRAM', mode: 'tram' as const, color: 'E0001B', textColor: 'FFFFFF' };
const o2 = { id: 'O2', name: 'O2', mode: 'bus' as const, color: '009FE3', textColor: 'FFFFFF' };
const direct = (dep: string, arr: string): Journey => ({
  legs: [{ line: tram, headsign: 'HOPITAL DEBRE', from: stop('NEUFCHATEL'), to: stop('OPERA'), depart: at(dep), arrive: at(arr), stops: 10 }],
  arrive: at(arr),
  boardWalk: 120,
  finalWalk: 200,
});
const journeys = [direct('08:05', '08:21'), direct('08:10', '08:27')];

test("nextJourney : le premier qu'on attrape en marchant jusqu'au quai", () => {
  assert.equal(nextJourney(journeys, Date.parse(at('08:03')))?.legs[0].depart, at('08:05')); // quai à 8 h 04 min 40
  assert.equal(nextJourney(journeys, Date.parse(at('08:04')))?.legs[0].depart, at('08:10'));
  assert.equal(nextJourney(journeys, Date.parse(at('08:11'))), undefined);
});

test('relayDuration : marche, attente, trajet et marche finale', () => {
  assert.equal(relayDuration(journeys, Date.parse(at('08:03')), 300), 18 * 60 + 300);
  assert.equal(relayDuration(journeys, Date.parse(at('08:30')), 0), null);
});

test('linesLabel : tram, puis bus', () => {
  assert.equal(linesLabel(journeys[0]), 'Tram');
  const transfer: Journey = {
    ...journeys[0],
    legs: [
      journeys[0].legs[0],
      { from: stop('GARE'), to: stop('GARE BUS'), depart: at('08:21'), arrive: at('08:23') },
      { line: o2, headsign: 'WILSON', from: stop('GARE BUS'), to: stop('WILSON'), depart: at('08:25'), arrive: at('08:40'), stops: 9 },
    ],
  };
  assert.equal(linesLabel(transfer), 'Tram puis bus O2');
});

test('titleCase', () => {
  assert.equal(titleCase('OPERA-CATHEDRALE'), 'Opera-Cathedrale');
  assert.equal(titleCase('GARE CHAMP. TGV'), 'Gare Champ. TGV');
});

test("stopName : garde le nom accentué d'OSM, met en forme le nom Citura", () => {
  assert.equal(stopName('Opéra-Cathédrale'), 'Opéra-Cathédrale');
  assert.equal(stopName('ST THOMAS'), 'St Thomas');
});
