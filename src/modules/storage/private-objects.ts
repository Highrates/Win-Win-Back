import { posix } from 'path';

/**
 * Ключи с персональными файлами покупателей: вложения чатов заказов/подборов и файлы заявок на подбор.
 * Не раздаются публично (ни статикой /uploads, ни из публичного bucket) — только через GET /files/:ref.
 */
const PRIVATE_KEY_PATTERNS: readonly RegExp[] = [
  /^objects\/chat\//,
  /^objects\/sourcing-requests\/[^/]+\/attachments\//,
];

/** Нормализация как у файловой системы: `..`, `//`, регистр (macOS / Windows без учёта регистра). */
function normalizeKey(key: string): string {
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    /* оставляем как есть */
  }
  return posix
    .normalize(`/${decoded.replace(/\\/g, '/')}`)
    .replace(/^\/+/, '')
    .toLowerCase();
}

export function isPrivateObjectKey(key: string): boolean {
  const k = normalizeKey(key);
  return PRIVATE_KEY_PATTERNS.some((re) => re.test(k));
}

/** Префиксы для листинга при переносе старых объектов в приватный bucket. */
export const PRIVATE_OBJECT_LIST_PREFIXES = ['objects/chat/', 'objects/sourcing-requests/'] as const;
