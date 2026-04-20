/**
 * Единая логика «какие картинки показывать для варианта» — как на PDP, так и в Meilisearch.
 * Порядок: junction (подмножество ProductImage) → общая галерея товара.
 */

export type GalleryImageLike = { url: string; alt?: string | null };

export function resolveEffectiveVariantImages(params: {
  sharedProductImages: GalleryImageLike[];
  variantProductImagesFromJunction: { productImage: { url: string; alt: string | null } }[];
}): GalleryImageLike[] {
  const fromJunction = params.variantProductImagesFromJunction.map((l) => ({
    url: l.productImage.url,
    alt: l.productImage.alt,
  }));
  if (fromJunction.length > 0) return fromJunction;
  return params.sharedProductImages;
}

/** Для поиска: только URL, максимум 6 как в buildProductSearchDocument. */
export function resolveEffectiveVariantImageUrlsForSearch(params: {
  sharedUrls: string[];
  junctionUrls: string[];
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
  return pick(params.sharedUrls);
}
