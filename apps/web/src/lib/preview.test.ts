import { expect, it } from 'vitest';

import { preview } from './preview';

it('réduit la liste au premier élément et les tracés à deux points', () => {
  const body = JSON.stringify({ items: [{ id: 'a', lines: [[[1, 2], [3, 4], [5, 6]]] }, { id: 'b' }, { id: 'c' }] });
  expect(JSON.parse(preview(body))).toEqual({ items: [{ id: 'a', lines: [[[1, 2], [3, 4], '… 1 de plus']] }, '… 2 de plus'] });
  expect(preview('{"items":[]}')).toBe('{\n  "items": []\n}');
  expect(preview('pas du json')).toBe('pas du json');
});
