import { describe, expect, it } from 'vitest';
import { orderToursByFeaturedIds } from './china-tours-featured';

describe('orderToursByFeaturedIds', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('без featured возвращает исходный порядок', () => {
    expect(orderToursByFeaturedIds(rows, [])).toEqual(rows);
  });

  it('упорядочивает по featuredTourIds', () => {
    expect(orderToursByFeaturedIds(rows, ['c', 'a']).map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('пропускает id, которых нет среди опубликованных', () => {
    expect(orderToursByFeaturedIds(rows, ['x', 'b', 'y', 'a']).map((t) => t.id)).toEqual([
      'b',
      'a',
    ]);
  });
});
