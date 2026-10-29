import { expect, it } from 'vitest';

import { toCsv } from './csv';

const BOM = '﻿';

it('échappe les points-virgules et les guillemets', () => {
  expect(toCsv([['a', 1], ['Parking "Erlon"; centre', 2]])).toBe(BOM + 'a;1\r\n"Parking ""Erlon""; centre";2');
});

it('écrit les décimales avec une virgule', () => {
  expect(toCsv([[2.5, -0.75, 1e21, Number.NaN]])).toBe(BOM + '2,5;-0,75;1e+21;');
});

it('neutralise les formules dans les textes', () => {
  const rows = [['=HYPERLINK("http://x";"clic")', '+1', '-2', '@SUM(A1)', '\tx', '\rx', 'a=b']];
  expect(toCsv(rows)).toBe(BOM + `"'=HYPERLINK(""http://x"";""clic"")";'+1;'-2;'@SUM(A1);'\tx;"'\rx";a=b`);
});

it('cite un retour chariot seul', () => {
  expect(toCsv([['a\rb']])).toBe(BOM + '"a\rb"');
});
