import { parseModificationSizeLabel } from './parse-modification-size';

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
  /** Кейсы партнёров с этим товаром (публичный счётчик). */
  casesLinkedCount?: number;
  likesUserCount?: number;
  likesAdminBoost?: number;
  catalogTagIds?: string[];
  qaMessageCountPublic?: number;
  /** Размеры из названий модификаций (до « · »). */
  sizeLabels?: string[];
  /** Id материалов бренда, доступных на элементах товара. */
  brandMaterialIds?: string[];
  hasModel3d?: boolean;
  hasDrawing?: boolean;
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

export function collectSizeLabelsFromModifications(
  modifications: { name: string }[] | undefined,
): string[] {
  if (!modifications?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of modifications) {
    const label = parseModificationSizeLabel(m.name);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function collectBrandMaterialIdsFromElements(
  elements:
    | {
        availabilities: {
          brandMaterialColor: { brandMaterialId: string };
        }[];
      }[]
    | undefined,
): string[] {
  if (!elements?.length) return [];
  const ids = new Set<string>();
  for (const el of elements) {
    for (const a of el.availabilities) {
      const id = a.brandMaterialColor.brandMaterialId?.trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
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
  const likesUser = typeof row.likesUserCount === 'number' ? row.likesUserCount : 0;
  const likesAdmin = typeof row.likesAdminBoost === 'number' ? row.likesAdminBoost : 0;
  const likesDisplayCount = Math.max(0, likesUser + likesAdmin);
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
    casesLinkedCount: row.casesLinkedCount ?? 0,
    qaMessageCountPublic: row.qaMessageCountPublic ?? 0,
    likesDisplayCount,
    sizeLabels: row.sizeLabels ?? [],
    brandMaterialIds: row.brandMaterialIds ?? [],
    hasModel3d: Boolean(row.hasModel3d),
    hasDrawing: Boolean(row.hasDrawing),
    ...(row.catalogTagIds?.length ? { catalogTagIds: row.catalogTagIds } : {}),
  };
}
