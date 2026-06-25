/** Лимиты заявки на подбор — единый контракт фронт / Nest. */
export const SOURCING_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const SOURCING_MAX_FILES = 50;
export const SOURCING_UPLOAD_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const SOURCING_MAX_PRODUCTS = 50;
export const SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT = 20;
export const SOURCING_MAX_ATTACHMENT_KEYS = 50;
export const SOURCING_FILE_KEY_MAX = 128;

export const SOURCING_TITLE_MAX = 200;
export const SOURCING_CITY_MAX = 200;
export const SOURCING_PRODUCT_NAME_MAX = 200;
export const SOURCING_PRODUCT_DESCRIPTION_MAX = 5000;
export const SOURCING_PRODUCT_FIELD_MAX = 500;
export const SOURCING_PRODUCT_LINK_MAX = 2048;
export const SOURCING_BUDGET_MAX = 32;

export const SOURCING_UNIT_OPTIONS = [
  'шт',
  'комплект',
  'м²',
  'м.п.',
  'кг',
  'упак.',
  'пара',
  'лист',
  'м³',
  'т',
] as const;

export type SourcingUnit = (typeof SOURCING_UNIT_OPTIONS)[number];

export const SOURCING_LIST_DEFAULT_LIMIT = 20;
export const SOURCING_LIST_MAX_LIMIT = 100;

export function clampSourcingListPage(page: number): number {
  return Math.max(Number.isFinite(page) ? page : 1, 1);
}

export function clampSourcingListLimit(limit: number): number {
  const n = Number.isFinite(limit) ? limit : SOURCING_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), SOURCING_LIST_MAX_LIMIT);
}
