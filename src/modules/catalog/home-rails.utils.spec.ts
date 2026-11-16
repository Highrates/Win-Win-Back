import { describe, expect, it } from 'vitest';
import { CuratedHomeGridSize, CuratedHomeOrderMode } from '@prisma/client';
import {
  computeHomePreviewCount,
  filterByHomePriceRange,
  findHomeOrderClash,
  homeGridLimit,
  moscowCalendarDay,
  seededShuffle,
  selectHomeRailProducts,
} from './home-rails.utils';

describe('moscowCalendarDay', () => {
  it('uses Europe/Moscow, not UTC midnight', () => {
    // 2026-03-15 23:30 UTC = 2026-03-16 02:30 MSK
    const lateUtc = new Date('2026-03-15T23:30:00.000Z');
    expect(lateUtc.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(moscowCalendarDay(lateUtc)).toBe('2026-03-16');
  });

  it('stays previous Moscow day before UTC midnight when MSK already next day… inverse', () => {
    // 2026-03-15 20:30 UTC = 2026-03-15 23:30 MSK
    const beforeMskMidnight = new Date('2026-03-15T20:30:00.000Z');
    expect(moscowCalendarDay(beforeMskMidnight)).toBe('2026-03-15');
  });
});

describe('seededShuffle', () => {
  it('is stable for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const a = seededShuffle(items, 'col:2026-03-16');
    const b = seededShuffle(items, 'col:2026-03-16');
    expect(a).toEqual(b);
    expect(a).not.toEqual(items);
  });

  it('changes order when day seed changes', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const d1 = seededShuffle(items, 'col:2026-03-16');
    const d2 = seededShuffle(items, 'col:2026-03-17');
    expect(d1).not.toEqual(d2);
  });

  it('does not mutate input', () => {
    const items = ['a', 'b', 'c'];
    const copy = [...items];
    seededShuffle(items, 'x');
    expect(items).toEqual(copy);
  });
});

describe('homeGridLimit', () => {
  it('maps FOUR / EIGHT / UNLIMITED', () => {
    expect(homeGridLimit(CuratedHomeGridSize.FOUR)).toBe(4);
    expect(homeGridLimit(CuratedHomeGridSize.EIGHT)).toBe(8);
    expect(homeGridLimit(CuratedHomeGridSize.UNLIMITED)).toBeUndefined();
  });
});

describe('selectHomeRailProducts', () => {
  const products = [
    { id: '1', price: 1000 },
    { id: '2', price: 5000 },
    { id: '3', price: 9000 },
    { id: '4', price: 12000 },
    { id: '5', price: null },
  ];

  it('FIXED keeps order and applies grid limit', () => {
    const out = selectHomeRailProducts(products, {
      mode: CuratedHomeOrderMode.FIXED,
      gridSize: CuratedHomeGridSize.FOUR,
      priceMin: 2000,
      priceMax: 8000,
      seedKey: 'ignored',
    });
    expect(out.map((p) => p.id)).toEqual(['1', '2', '3', '4']);
  });

  it('RANDOM filters by price then limits', () => {
    const filtered = filterByHomePriceRange(products, 2000, 10000);
    expect(filtered.map((p) => p.id)).toEqual(['2', '3']);

    const out = selectHomeRailProducts(products, {
      mode: CuratedHomeOrderMode.RANDOM,
      gridSize: CuratedHomeGridSize.FOUR,
      priceMin: 2000,
      priceMax: 10000,
      seedKey: 'col:2026-03-16',
    });
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.id === '2' || p.id === '3')).toBe(true);
  });

  it('RANDOM with empty filter result yields empty rail', () => {
    const out = selectHomeRailProducts(products, {
      mode: CuratedHomeOrderMode.RANDOM,
      gridSize: CuratedHomeGridSize.EIGHT,
      priceMin: 50_000,
      priceMax: 60_000,
      seedKey: 'col:day',
    });
    expect(out).toEqual([]);
  });
});

describe('computeHomePreviewCount', () => {
  it('returns 0 when not on home or inactive', () => {
    expect(
      computeHomePreviewCount({
        showOnHome: false,
        isActive: true,
        homeGridSize: CuratedHomeGridSize.FOUR,
        homeOrderMode: CuratedHomeOrderMode.FIXED,
        homePriceMin: null,
        homePriceMax: null,
        prices: [1, 2, 3],
      }),
    ).toBe(0);
  });

  it('caps by grid after RANDOM price filter', () => {
    expect(
      computeHomePreviewCount({
        showOnHome: true,
        isActive: true,
        homeGridSize: CuratedHomeGridSize.FOUR,
        homeOrderMode: CuratedHomeOrderMode.RANDOM,
        homePriceMin: 100,
        homePriceMax: 500,
        prices: [50, 200, 300, 400, 450, 600],
      }),
    ).toBe(4);
  });
});

describe('findHomeOrderClash', () => {
  const rows = [
    {
      id: 'a',
      name: 'Active A',
      showOnHome: true,
      isActive: true,
      homeOrder: 1,
    },
    {
      id: 'b',
      name: 'Hidden B',
      showOnHome: true,
      isActive: false,
      homeOrder: 2,
    },
    {
      id: 'c',
      name: 'Off home C',
      showOnHome: false,
      isActive: true,
      homeOrder: 2,
    },
  ];

  it('detects clash with active showOnHome peer', () => {
    expect(findHomeOrderClash(1, rows)?.id).toBe('a');
  });

  it('ignores inactive and showOnHome=false holders of the same order', () => {
    expect(findHomeOrderClash(2, rows)).toBeNull();
  });

  it('excludes self by id', () => {
    expect(findHomeOrderClash(1, rows, 'a')).toBeNull();
  });
});
