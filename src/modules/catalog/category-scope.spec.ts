import { describe, expect, it } from 'vitest';
import {
  collectCategoryAndDescendantIds,
  countUniqueProductsInCategoryScope,
  meilisearchCategoryScopeFilter,
} from './category-scope';

describe('collectCategoryAndDescendantIds', () => {
  const tree = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'grand', parentId: 'child' },
    { id: 'other', parentId: null },
  ];

  it('includes self and all descendants', () => {
    expect(collectCategoryAndDescendantIds('root', tree).sort()).toEqual(
      ['root', 'child', 'grand'].sort(),
    );
  });

  it('returns only self for leaf category', () => {
    expect(collectCategoryAndDescendantIds('grand', tree)).toEqual(['grand']);
  });

  it('does not include siblings or unrelated branches', () => {
    const ids = collectCategoryAndDescendantIds('child', tree);
    expect(ids).toContain('child');
    expect(ids).toContain('grand');
    expect(ids).not.toContain('root');
    expect(ids).not.toContain('other');
  });
});

describe('countUniqueProductsInCategoryScope', () => {
  const tree = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'other', parentId: null },
  ];

  it('counts unique products across root and descendants', () => {
    const byCat = new Map<string, Set<string>>([
      ['root', new Set(['p1'])],
      ['child', new Set(['p1', 'p2'])],
      ['other', new Set(['p3'])],
    ]);
    expect(countUniqueProductsInCategoryScope('root', tree, byCat)).toBe(2);
    expect(countUniqueProductsInCategoryScope('child', tree, byCat)).toBe(2);
    expect(countUniqueProductsInCategoryScope('other', tree, byCat)).toBe(1);
  });
});

describe('meilisearchCategoryScopeFilter', () => {
  it('builds single-id filter', () => {
    expect(meilisearchCategoryScopeFilter(['a'])).toBe('categoryIds = "a"');
  });

  it('builds OR filter for multiple ids', () => {
    expect(meilisearchCategoryScopeFilter(['a', 'b'])).toBe(
      '(categoryIds = "a" OR categoryIds = "b")',
    );
  });
});
