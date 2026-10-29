import { describe, expect, it } from 'vitest';

import { address, period, within, ago, formatLitre, formatNumber, formatPercent, parkingName, since, today, updated } from './format';

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

describe('textes', () => {
  it('remet en forme les adresses en capitales', () => {
    expect(address('12 AVENUE DE LAON')).toBe('12 Avenue de Laon');
    expect(address("RUE D'ÉPERNAY")).toBe("Rue d'Épernay");
    expect(address('ROUTE DE WITRY-LES-REIMS')).toBe('Route de Witry-les-Reims');
    expect(address('RN 44')).toBe('RN 44');
    expect(address('ZAC DES ESSILLARDS')).toBe('ZAC des Essillards');
    expect(address('RUE DE LA ZONE')).toBe('Rue de la Zone');
    expect(address('Centre commercial Cora')).toBe('Centre commercial Cora');
  });

  it('« il y a » sans doublon à l’instant', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(since(new Date('2026-10-29T09:59:50Z'), now)).toBe('à l’instant');
    expect(since(new Date('2026-10-29T09:40:00Z'), now)).toBe('il y a 20 min');
  });

  it('période d’une fermeture', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(period('2026-10-20T06:00:00Z', '2026-11-07T17:00:00Z', now)).toBe('jusqu’au 7 novembre');
    expect(period('2026-11-10T06:00:00Z', '2026-11-14T17:00:00Z', now)).toBe('10 → 14 nov.');
    expect(period('2026-11-28T06:00:00Z', '2026-12-02T17:00:00Z', now)).toBe('28 nov. → 2 déc.');
    expect(period('2026-12-03T06:00:00Z', null, now)).toBe('à partir du 3 décembre');
    expect(period(null, null, now)).toBe('sans date de fin');
    expect(within(new Date('2026-10-29T12:00:00Z'), now)).toBe('2 h');
  });
});

describe('updated : état du chargement', () => {
  const now = new Date('2026-10-29T10:00:00+01:00');
  it('chargement, échec avant toute donnée, puis heure de mise à jour', () => {
    expect(updated(null, now)).toBe('chargement…');
    expect(updated(null, now, true)).toBe('données indisponibles');
    expect(updated(new Date('2026-10-29T09:58:00+01:00'), now, true)).toMatch(/^mis à jour /);
  });
});
