/**
 * Единая логика «какие картинки показывать для варианта» — как на PDP, так и в Meilisearch.
 * Порядок: junction (подмножество ProductImage) → legacy ProductVariantImage → общая галерея товара.
 */

export type GalleryImageLike = { url: string; alt?: string | null };

export function resolveEffectiveVariantImages(params: {
  sharedProductImages: GalleryImageLike[];
  variantProductImagesFromJunction: { productImage: { url: string; alt: string | null } }[];
  variantLegacyImages: GalleryImageLike[];
}): GalleryImageLike[] {
  const fromJunction = params.variantProductImagesFromJunction.map((l) => ({
    url: l.productImage.url,
    alt: l.productImage.alt,
  }));
  if (fromJunction.length > 0) return fromJunction;
  if (params.variantLegacyImages.length > 0) return params.variantLegacyImages;
  return params.sharedProductImages;
}

/** Для поиска: только URL, максимум 6 как в buildProductSearchDocument. */
export function resolveEffectiveVariantImageUrlsForSearch(params: {
  sharedUrls: string[];
  junctionUrls: string[];
  legacyUrls: string[];
  max?: number;
}): { url: string }[] {
  const max = params.max ?? 6;
  const pick = (urls: string[]) =>
    urls
      .map((u) => u?.trim())
      .filter(Boolean)
      .slice(0, max)
      .map((url) => ({ url: url! }));

  if (params.junctionUrls.length) return pick(params.junctionUrls);
  if (params.legacyUrls.length) return pick(params.legacyUrls);
  return pick(params.sharedUrls);
}
