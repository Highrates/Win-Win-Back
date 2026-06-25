export type SourcingProductFilledInput = {
  name?: string | null;
  description?: string | null;
  productLink?: string | null;
  /** Число референсов (keys на бэке, images на фронте). */
  referenceCount?: number;
};

export function isProductMinimallyFilled(input: SourcingProductFilledInput): boolean {
  return Boolean(
    input.name?.trim() ||
      input.description?.trim() ||
      input.productLink?.trim() ||
      (input.referenceCount ?? 0) > 0,
  );
}

export function isSoftValidProductLink(value: string | undefined | null): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    return url.hostname.length > 0 && url.hostname.includes('.');
  } catch {
    return false;
  }
}
