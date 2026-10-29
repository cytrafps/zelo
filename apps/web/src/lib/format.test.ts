import { describe, expect, it } from 'vitest';

import { ago, formatLitre, formatNumber, formatPercent, parkingName, today, updated } from './format';

describe('format', () => {
  it('écrit les nombres à la française', () => {
    expect(formatNumber(3418)).toBe('3 418');
    expect(formatPercent(0.718)).toBe('72\u202f%');
    expect(formatLitre(1.6789)).toBe('1,679 €');
  });

  it('donne la durée écoulée en clair', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(ago(new Date('2026-10-29T09:59:40Z'), now)).toBe('à l’instant');
    expect(ago(new Date('2026-10-29T09:42:00Z'), now)).toBe('18 min');
    expect(ago(new Date('2026-10-29T08:00:00Z'), now)).toBe('2 h');
    expect(ago(new Date('2026-10-26T10:00:00Z'), now)).toBe('3 j');
    expect(updated(null, now)).toBe('chargement…');
    expect(updated(new Date('2026-10-29T09:58:00Z'), now)).toBe('mis à jour il y a 2 min');
  });

  it('date du jour en heure de Paris', () => {
    expect(today(new Date('2026-10-29T08:00:00Z'))).toBe('Aujourd’hui, jeudi 29 octobre');
  });
});

it('nom de parking sans le mot « Parking »', () => {
  expect(parkingName('Parking rue de Vesle')).toBe('Rue de Vesle');
  expect(parkingName('Parking Erlon')).toBe('Erlon');
  expect(parkingName('P+R Belges')).toBe('P+R Belges');
  expect(parkingName('')).toBe('Sans nom');
});
