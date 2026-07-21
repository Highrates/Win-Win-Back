import type { Index } from 'meilisearch';

export async function applyProductIndexSearchSettings(
  index: Index<Record<string, unknown>>,
): Promise<void> {
  await index.updateSettings({
    searchableAttributes: ['name', 'slug', 'shortDescription', 'categoryName', 'brandName'],
    filterableAttributes: [
      'categoryId',
      'categoryIds',
      'brandId',
      'catalogTagIds',
      'isActive',
      'productId',
      'price',
      'sizeLabels',
      'brandMaterialIds',
      'casesLinkedCount',
      'hasModel3d',
      'hasDrawing',
    ],
    sortableAttributes: ['updatedAt', 'price', 'likesDisplayCount'],
  });
}
