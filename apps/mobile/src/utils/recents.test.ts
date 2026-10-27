/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pushRecent } from './recents.ts';

const p = (id: string) => ({ id });

test('pushRecent : la plus récente en tête, sans doublon', () => {
  assert.deepEqual(pushRecent([p('a'), p('b')], p('c')), [p('c'), p('a'), p('b')]);
  assert.deepEqual(pushRecent([p('a'), p('b'), p('c')], p('b')), [p('b'), p('a'), p('c')]);
});

test('pushRecent : limitée à max', () => {
  assert.deepEqual(pushRecent([p('a'), p('b'), p('c')], p('d'), 3), [p('d'), p('a'), p('b')]);
});
