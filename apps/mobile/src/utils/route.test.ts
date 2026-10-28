/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { along, bounds, cumulative, formatClock, formatDuration, deviation, pointAt, progress, segmentBearing, voiceDue, type Route } from './route.ts';

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

test("progress : sur un aller-retour, l'indice garde le guidage sur le bon passage", () => {
  // Aller vers l'est puis retour par la même rue : chaque point de l'aller existe aussi au retour.
  const go: [number, number][] = Array.from({ length: 11 }, (_, i) => [4.03 + i * 0.001, 49.25]);
  const loop: Route = {
    distance: 0,
    duration: 600,
    coordinates: [...go, ...go.slice(0, -1).reverse()],
    steps: [
      { instruction: 'Départ', type: 1, distance: 0, duration: 0, shape: 0 },
      { instruction: 'Demi-tour', type: 12, distance: 0, duration: 0, shape: 10 },
      { instruction: 'Arrivée', type: 4, distance: 0, duration: 0, shape: 20 },
    ],
  };
  const c = cumulative(loop.coordinates);
  const back = { lat: 49.25, lon: 4.0335 }; // entre les points 3 et 4, sur le chemin du retour
  const first = progress(loop, c, { lat: 49.25, lon: 4.0395 }); // juste avant le demi-tour
  const p = progress(loop, c, back, progress(loop, c, { lat: 49.25, lon: 4.0345 }, 16).segment);
  assert.ok(first.segment < 10);
  assert.equal(p.next, 2, 'après le demi-tour, la prochaine manœuvre est l’arrivée');
  assert.ok(p.segment >= 10);
  // Sans indice, la même position tombe sur l'aller.
  assert.ok(progress(loop, c, back).segment < 10);
});

test('annonces vocales : une fois chacune, au bon moment, sauf périmées', () => {
  const voice = [
    { before: 614, text: 'Continuez pendant 600 mètres.' },
    { before: 243, text: 'Dans 200 mètres, tournez à droite.' },
    { before: 69, text: 'Tournez à droite.' },
  ];
  assert.equal(voiceDue(voice, 700, 0), null);
  assert.deepEqual(voiceDue(voice, 610, 0), { next: 1, text: 'Continuez pendant 600 mètres.' });
  assert.equal(voiceDue(voice, 400, 1), null);
  assert.deepEqual(voiceDue(voice, 240, 1), { next: 2, text: 'Dans 200 mètres, tournez à droite.' });
  assert.deepEqual(voiceDue(voice, 60, 2), { next: 3, text: 'Tournez à droite.' });
  assert.equal(voiceDue(voice, 10, 3), null);
  // Reprise à 300 m du virage après un recalcul : « Continuez pendant 600 mètres » est périmée.
  assert.deepEqual(voiceDue(voice, 300, 0), { next: 1, text: '' });
  // Position sautée au-delà de deux annonces : seule la plus proche est dite.
  assert.deepEqual(voiceDue(voice, 65, 1), { next: 3, text: 'Tournez à droite.' });
  assert.equal(voiceDue(undefined, 10, 0), null);
});

test('écart : recalcul après 5 s hors de l’itinéraire, seuil élargi par un GPS imprécis', () => {
  const t0 = 1_000_000;
  let d = deviation(null, 45, { accuracy: 5 }, null, t0);
  assert.deepEqual(d, { since: t0, reroute: false });
  d = deviation(d.since, 50, { accuracy: 5 }, null, t0 + 3000);
  assert.equal(d.reroute, false);
  d = deviation(d.since, 50, { accuracy: 5 }, null, t0 + 5000);
  assert.equal(d.reroute, true);
  // De retour sur le tracé : le compteur repart de zéro.
  assert.deepEqual(deviation(t0, 10, { accuracy: 5 }, null, t0 + 6000), { since: null, reroute: false });
  // GPS à 60 m près : 45 m d'écart ne veut rien dire.
  assert.equal(deviation(null, 45, { accuracy: 60 }, null, t0).since, null);
  // Au-delà de 80 m, on est ailleurs quelle que soit la précision annoncée.
  assert.equal(deviation(null, 90, { accuracy: 200 }, null, t0).since, t0);
});

test('contresens : sur le tracé mais cap opposé', () => {
  assert.equal(deviation(null, 5, { heading: 10 }, 190, 0).since, 0);
  assert.equal(deviation(null, 5, { heading: 350 }, 20, 0).since, null);
  assert.equal(deviation(null, 5, { heading: null }, 190, 0).since, null);
  assert.equal(segmentBearing([[4, 49], [4, 49.001]], 0), 0);
  assert.ok(Math.abs((segmentBearing([[4, 49], [4.001, 49]], 0) ?? 0) - 90) < 1e-9);
});
