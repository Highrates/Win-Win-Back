import { CuratedHomeGridSize, CuratedHomeOrderMode } from '@prisma/client';

/** Календарный день в Europe/Moscow (YYYY-MM-DD) — seed для RANDOM-рельса. */
export function moscowCalendarDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) {
    // Fallback: не должен срабатывать в современных runtime.
    return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  }
  return `${y}-${m}-${d}`;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Стабильный Fisher–Yates по seedKey (обычно `${collectionId}:${moscowDay}`). */
export function seededShuffle<T>(items: T[], seedKey: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seedKey));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function homeGridLimit(size: CuratedHomeGridSize): number | undefined {
  if (size === CuratedHomeGridSize.FOUR) return 4;
  if (size === CuratedHomeGridSize.EIGHT) return 8;
  return undefined;
}

export function filterByHomePriceRange<T extends { price: number | null }>(
  products: T[],
  min: number | null,
  max: number | null,
): T[] {
  if (min == null && max == null) return products;
  return products.filter((p) => {
    const price = p.price;
    if (price == null || !Number.isFinite(price) || price <= 0) return false;
    if (min != null && price < min) return false;
    if (max != null && price > max) return false;
    return true;
  });
}

/** Filter / shuffle / grid limit — та же логика, что listHomeProductRails per-rail. */
export function selectHomeRailProducts<T extends { price: number | null }>(
  products: T[],
  opts: {
    mode: CuratedHomeOrderMode;
    gridSize: CuratedHomeGridSize;
    priceMin: number | null;
    priceMax: number | null;
    seedKey: string;
  },
): T[] {
  let list = [...products];
  if (opts.mode === CuratedHomeOrderMode.RANDOM) {
    list = filterByHomePriceRange(list, opts.priceMin, opts.priceMax);
    list = seededShuffle(list, opts.seedKey);
  }
  const limit = homeGridLimit(opts.gridSize);
  if (limit != null) list = list.slice(0, limit);
  return list;
}

/** Preview-счётчик для админки (без shuffle — только filter + limit). */
export function computeHomePreviewCount(input: {
  showOnHome: boolean;
  isActive: boolean;
  homeGridSize: CuratedHomeGridSize;
  homeOrderMode: CuratedHomeOrderMode;
  homePriceMin: number | null;
  homePriceMax: number | null;
  prices: Array<number | null>;
}): number {
  if (!input.showOnHome || !input.isActive) return 0;
  let prices = input.prices.map((p) => ({ price: p }));
  if (input.homeOrderMode === CuratedHomeOrderMode.RANDOM) {
    prices = filterByHomePriceRange(prices, input.homePriceMin, input.homePriceMax);
  }
  const limit = homeGridLimit(input.homeGridSize);
  return limit != null ? Math.min(limit, prices.length) : prices.length;
}

/**
 * Clash слота homeOrder: только среди showOnHome + isActive
 * (скрытая/неактивная коллекция слот не держит).
 */
export function findHomeOrderClash(
  homeOrder: number,
  occupied: Array<{
    id: string;
    name: string;
    showOnHome: boolean;
    isActive: boolean;
    homeOrder: number | null;
  }>,
  excludeId?: string,
): { id: string; name: string } | null {
  for (const row of occupied) {
    if (excludeId && row.id === excludeId) continue;
    if (!row.showOnHome || !row.isActive) continue;
    if (row.homeOrder === homeOrder) return { id: row.id, name: row.name };
  }
  return null;
}
