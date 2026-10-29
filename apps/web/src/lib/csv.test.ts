import { expect, it } from 'vitest';

import { toCsv } from './csv';

it('échappe les points-virgules et les guillemets', () => {
  expect(toCsv([['a', 1], ['Parking "Erlon"; centre', 2.5]])).toBe('﻿a;1\r\n"Parking ""Erlon""; centre";2.5');
});
