import { describe, expect, it } from 'vitest';

import type { ChargeStation, FuelStation, Parking, Report } from './api';
import { chargeSummary, cheapest, hourPrice, operatedParkings, recentReports, reportSummary } from './stats';

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
