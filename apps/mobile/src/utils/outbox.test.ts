/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enqueue, MAX_AGE_MS, nextAttempt, retryable, retryLater, split } from './outbox.ts';

test('file des signalements : envoi immédiat, essais espacés, abandon des trop vieux', () => {
  let q = enqueue([], { kind: 'bouchon', lat: 49.25, lon: 4.03 }, 1000);
  assert.equal(split(q, 1000).due.length, 1);
  const p = retryLater(q[0], 1000);
  assert.equal(p.nextAt, 6000);
  assert.equal(retryLater(retryLater(p, 6000), 16_000).nextAt, 16_000 + 20_000);
  assert.equal(retryLater({ ...p, tries: 10 }, 0).nextAt, 2 * 60_000);
  q = [p];
  assert.deepEqual(split(q, 3000), { due: [], keep: [p] });
  assert.deepEqual(split(q, 6000), { due: [p], keep: [] });
  assert.deepEqual(split(q, 1000 + MAX_AGE_MS), { due: [], keep: [] });
  assert.equal(nextAttempt(q), 6000);
  assert.equal(nextAttempt([]), null);
});

test('retryable : réseau absent, serveur en panne ou saturé ; pas un refus définitif', () => {
  for (const s of [null, 500, 502, 503, 429, 408]) assert.equal(retryable(s), true, String(s));
  for (const s of [400, 403, 404, 413, 422]) assert.equal(retryable(s), false, String(s));
});
