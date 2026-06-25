import {
  clampSourcingListLimit,
  clampSourcingListPage,
  SOURCING_LIST_DEFAULT_LIMIT,
} from '@win-win/sourcing-request';

export {
  SOURCING_BUDGET_MAX,
  SOURCING_CITY_MAX,
  SOURCING_FILE_KEY_MAX,
  SOURCING_FILE_MAX_BYTES,
  SOURCING_LIST_DEFAULT_LIMIT,
  SOURCING_LIST_MAX_LIMIT,
  SOURCING_MAX_ATTACHMENT_KEYS,
  SOURCING_MAX_FILES,
  SOURCING_MAX_PRODUCTS,
  SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT,
  SOURCING_PRODUCT_DESCRIPTION_MAX,
  SOURCING_PRODUCT_FIELD_MAX,
  SOURCING_PRODUCT_LINK_MAX,
  SOURCING_PRODUCT_NAME_MAX,
  SOURCING_TITLE_MAX,
  SOURCING_UNIT_OPTIONS,
  SOURCING_UPLOAD_TOTAL_MAX_BYTES,
  clampSourcingListLimit,
  clampSourcingListPage,
} from '@win-win/sourcing-request';

export function parseSourcingListPage(raw?: string): number {
  const n = raw ? parseInt(raw, 10) : 1;
  return clampSourcingListPage(Number.isFinite(n) ? n : 1);
}

export function parseSourcingListLimit(raw?: string): number {
  const n = raw ? parseInt(raw, 10) : SOURCING_LIST_DEFAULT_LIMIT;
  return clampSourcingListLimit(Number.isFinite(n) ? n : SOURCING_LIST_DEFAULT_LIMIT);
}
