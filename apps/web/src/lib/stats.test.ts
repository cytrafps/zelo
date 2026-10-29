import { describe, expect, it } from 'vitest';

import type { ChargeStation, FuelStation, Parking, Report } from './api';
import { completeDays, freshFuel, fuelStats, weekChange, capacitySummary, chargeOffer, chargeSummary, nearestStation, stationState, cheapest, hourPrice, operatedParkings, parkingTable, recentReports, reportSummary } from './stats';

const station = (total: number, available: number | null) => ({ total, available }) as ChargeStation;
const report = (id: number, kind: Report['kind'], createdAt: string) => ({ id, kind, createdAt }) as Report;

describe('stats', () => {
  it('compte les points libres parmi les états connus', () => {
    expect(chargeSummary([station(4, 2), station(2, null), station(6, 7)])).toEqual({ free: 8, known: 10, unknown: 2, ratio: 0.8 });
    expect(chargeSummary([station(2, null)]).ratio).toBeNull();
  });

  it('résume les signalements', () => {
    const rs = [report(1, 'travaux', '2026-10-29T08:00:00Z'), report(2, 'accident', '2026-10-29T09:00:00Z'), report(3, 'travaux', '2026-10-29T07:00:00Z')];
    expect(reportSummary(rs)).toEqual({ count: 3, top: { kind: 'travaux', count: 2 } });
    expect(reportSummary([]).top).toBeNull();
    expect(recentReports(rs, 2).map((r) => r.id)).toEqual([2, 1]);
  });

  it('écarte les prix de plus de 7 jours', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    const s = (id: string, price: number, updatedAt: string) => ({ id, prices: { Gazole: price }, updatedAt }) as unknown as FuelStation;
    const best = cheapest([s('a', 1.5, '2026-10-10T00:00:00Z'), s('b', 1.7, '2026-10-28T00:00:00Z'), s('c', 1.65, '2026-10-29T06:00:00Z')], 'Gazole', now);
    expect(best?.station.id).toBe('c');
    expect(cheapest([], 'Gazole', now)).toBeNull();
  });

  it('parkings exploités, les plus grands d’abord, prix d’une heure', () => {
    const tariff = { free: 30, prices: [{ minutes: 60, cents: 180 }], source: '', checked: '' };
    const ps = [
      { id: 'a', capacity: 200, tariff },
      { id: 'b', capacity: 600, tariff },
      { id: 'c', capacity: 900, tariff: null },
    ] as Parking[];
    expect(operatedParkings(ps, 5).map((p) => p.id)).toEqual(['b', 'a']);
    expect(hourPrice(ps[0]!)).toBe(180);
    expect(hourPrice(ps[2]!)).toBeNull();
  });
});

describe('stationnement', () => {
  const tariff = { free: 30, prices: [{ minutes: 60, cents: 180 }], source: '', checked: '' };
  const p = (id: string, capacity: number | null, extra: Partial<Parking> = {}) =>
    ({ id, capacity, disabled: null, tariff: null, parkRide: false, ...extra }) as Parking;

  it('tableau : exploités, puis les plus grands, puis les P+R', () => {
    const centre = [p('rue', 40), p('erlon', 520, { tariff }), p('grand', 900), p('sans', null), p('gare', 400, { tariff })];
    const relays = [p('pr-belges', 400, { parkRide: true }), p('erlon', 520, { tariff })];
    expect(parkingTable(centre, relays, 12).map((x) => x.id)).toEqual(['erlon', 'gare', 'grand', 'rue', 'pr-belges']);
    expect(parkingTable(centre, relays, 2).map((x) => x.id)).toEqual(['erlon', 'gare']);
  });

  it('somme les places connues', () => {
    expect(capacitySummary([p('a', 100, { disabled: 3 }), p('b', null), p('c', 50)])).toEqual({ places: 150, disabled: 3, withDisabled: 1, unknown: 1, total: 3 });
  });
});

describe('recharge', () => {
  const st = (id: string, lat: number, available: number | null, extra: Partial<ChargeStation> = {}) =>
    ({ id, lat, lon: 4.03, total: 2, available, maxPowerKw: 22, price: null, ...extra }) as ChargeStation;
  const broken = { kind: 'borne_hs', lat: 49.25, lon: 4.03 } as Report;

  it('état : panne signalée, puis état publié', () => {
    expect(stationState(st('a', 49.2502, 1), [broken])).toBe('panne'); // ~22 m
    expect(stationState(st('b', 49.26, 0), [broken])).toBe('complet');
    expect(stationState(st('c', 49.26, null), [])).toBe('inconnu');
    expect(stationState(st('d', 49.26, 2), [])).toBe('service');
  });

  it('station la plus proche d’un signalement', () => {
    expect(nearestStation(broken, [st('loin', 49.252, 1), st('près', 49.2503, 1)])?.id).toBe('près');
    expect(nearestStation(broken, [st('loin', 49.252, 1)])).toBeNull();
  });

  it('points rapides et prix moyen', () => {
    const o = chargeOffer([
      st('a', 49.25, 1, { maxPowerKw: 150, total: 4, price: { free: false, kwh: 0.5, from: false } }),
      st('b', 49.25, 1, { price: { free: false, kwh: 0.3, from: true } }),
      st('c', 49.25, 1, { price: { free: true, kwh: 0, from: false } }),
    ]);
    expect(o).toEqual({ fast: 4, fastStations: 1, avgKwh: 0.4, priced: 2 });
  });

  it('carburant : moyenne sur les stations à jour', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    const s = (id: string, prices: Record<string, number>, updatedAt: string) => ({ id, prices, updatedAt }) as unknown as FuelStation;
    const all = [s('a', { E10: 1.7, Gazole: 1.6 }, '2026-10-29T06:00:00Z'), s('b', { E10: 1.8 }, '2026-10-28T06:00:00Z'), s('c', { E10: 1.0 }, '2026-10-01T00:00:00Z')];
    const fresh = freshFuel(all, now);
    expect(fresh.map((x) => x.id)).toEqual(['a', 'b']);
    expect(fuelStats(fresh, 'E10')).toEqual({ avg: 1.75, min: 1.7, max: 1.8, count: 2 });
    expect(fuelStats(fresh, 'E85')).toBeNull();
  });

  it('tendance : jours complets et évolution sur 7 jours', () => {
    const d = (day: string, avg: number, stations: number) => ({ day, avg, min: avg, max: avg, stations });
    const days = [d('2026-10-20', 1.8, 10), d('2026-10-21', 1.79, 40), d('2026-10-22', 1.78, 50), d('2026-10-29', 1.75, 52)];
    expect(completeDays(days).map((x) => x.day)).toEqual(['2026-10-22', '2026-10-29']);
    expect(weekChange(days)).toBeCloseTo(-0.03);
    expect(weekChange(days.slice(1, 2))).toBeNull();
    expect(weekChange([])).toBeNull();
  });
});
