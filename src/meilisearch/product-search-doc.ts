/** Строка для индекса: один документ = один товар (карточка витрины). */
export type ProductVariantSearchIndexRow = {
  /** id товара — primary key в Meilisearch */
  id: string;
  productId: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  categoryId: string;
  categoryIds: string[];
  brandId: string | null;
  isActive: boolean;
  updatedAt: Date;
  category: { name: string };
  brand: { name: string } | null;
  /** Минимальная цена среди вариантов (сортировка) */
  sortPrice: number;
  priceMin: number;
  priceMax: number;
  /** Изображения товара (общая галерея) */
  images?: { url: string }[];
};

/** @deprecated используйте ProductVariantSearchIndexRow */
export type ProductSearchIndexRow = ProductVariantSearchIndexRow;

export function collectProductCategoryIds(
  primaryId: string,
  links: { categoryId: string }[],
): string[] {
  const s = new Set<string>([primaryId]);
  for (const l of links) s.add(l.categoryId);
  return [...s];
}

export function priceToNumber(price: unknown): number {
  if (price == null) return 0;
  if (typeof price === 'number' && Number.isFinite(price)) return price;
  if (typeof price === 'object' && price !== null && 'toString' in price) {
    const n = parseFloat(String((price as { toString(): string }).toString()));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(price);
  return Number.isFinite(n) ? n : 0;
}

const CARD_GALLERY_IMAGE_MAX = 6;

function collectImageUrls(images: { url: string }[] | undefined): string[] {
  if (!images?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const im of images) {
    const u = im.url?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= CARD_GALLERY_IMAGE_MAX) break;
  }
  return out;
}

export function buildProductSearchDocument(row: ProductVariantSearchIndexRow): Record<string, unknown> {
  const imageUrls = collectImageUrls(row.images);
  const thumbUrl = imageUrls[0] ?? null;
  return {
    id: row.id,
    productId: row.productId,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription ?? '',
    categoryId: row.categoryId,
    categoryIds: row.categoryIds,
    categoryName: row.category.name,
    brandId: row.brandId,
    brandName: row.brand?.name ?? null,
    isActive: row.isActive,
    updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
    price: row.sortPrice,
    priceMin: row.priceMin,
    priceMax: row.priceMax,
    thumbUrl,
    imageUrls,
  };
}
