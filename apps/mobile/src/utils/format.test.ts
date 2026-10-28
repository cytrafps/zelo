import assert from 'node:assert/strict';
import { test } from 'node:test';

// Hermes, le moteur JavaScript de l'app, n'a pas Intl.RelativeTimeFormat : on le retire
// AVANT de charger le module, pour reproduire le téléphone (un appel au chargement planterait).
const intl = Intl as unknown as Record<string, unknown>;
delete intl.RelativeTimeFormat;
const { formatAgo, formatCents, formatPrice, formatStay } = await import('./format.ts');

const now = Date.parse('2026-10-26T20:00:00Z');
const at = (min: number) => new Date(now + min * 60_000).toISOString();

test('formatAgo sans Intl.RelativeTimeFormat', () => {
  assert.equal(formatAgo(at(0), now), 'à l’instant');
  assert.equal(formatAgo(at(-5), now), 'il y a 5 min');
  assert.equal(formatAgo(at(45), now), 'dans 45 min');
  assert.equal(formatAgo(at(-180), now), 'il y a 3 h');
  assert.equal(formatAgo(at(-26 * 60), now), 'hier');
  assert.equal(formatAgo(at(26 * 60), now), 'demain');
  assert.equal(formatAgo(at(-3 * 24 * 60), now), 'il y a 3 jours');
});

test('formatPrice', () => {
  assert.match(formatPrice(1.789), /^1,789\s€$/);
});

test('formatCents et formatStay', () => {
  assert.equal(formatCents(120).replace(/\u202f|\u00a0/g, ' '), '1,20 €');
  assert.equal(formatCents(0), 'Gratuit');
  assert.equal(formatStay(30), '30 min');
  assert.equal(formatStay(1440), '24 h');
});
