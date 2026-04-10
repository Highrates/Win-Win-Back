import type { Index } from 'meilisearch';

export async function applyProductIndexSearchSettings(
  index: Index<Record<string, unknown>>,
): Promise<void> {
  await index.updateSettings({
    searchableAttributes: ['name', 'slug', 'shortDescription', 'categoryName', 'brandName'],
    filterableAttributes: ['categoryId', 'categoryIds', 'brandId', 'isActive', 'productId'],
    sortableAttributes: ['updatedAt'],
  });
}
