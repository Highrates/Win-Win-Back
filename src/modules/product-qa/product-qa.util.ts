import {
  PRODUCT_QA_DEFAULT_TOPIC_SLUG,
  PRODUCT_QA_TOPIC_SLUG_MAX_CHARS,
} from './product-qa.constants';

/** Нормализация slug топика из заголовка или явного значения. */
export function normalizeProductQaTopicSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PRODUCT_QA_TOPIC_SLUG_MAX_CHARS);
  return s || PRODUCT_QA_DEFAULT_TOPIC_SLUG;
}
