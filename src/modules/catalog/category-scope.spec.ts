import { describe, expect, it } from 'vitest';
import {
  collectCategoryAndDescendantIds,
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
