/** Размер «хвоста» и страницы «раньше». */
export const PRODUCT_QA_MESSAGES_PAGE_DEFAULT = 30;
export const PRODUCT_QA_MESSAGES_PAGE_MAX = 100;

/** Одно текстовое поле сообщения (должен совпадать с dto). */
export const PRODUCT_QA_BODY_MAX_CHARS = 4000;

/** Минимальный интервал между сообщениями одного пользователя по товару (мс). */
export const PRODUCT_QA_POST_COOLDOWN_MS = 15_000;

/** Окно редактирования своего сообщения USER (мс). */
export const PRODUCT_QA_EDIT_WITHIN_MS = 15 * 60 * 1000;

/** Throttle: POST сообщений пользователем. */
export const PRODUCT_QA_POST_THROTTLE = { default: { ttl: 60_000, limit: 10 } } as const;

/** Throttle: upload вложений (user + staff). */
export const PRODUCT_QA_UPLOAD_THROTTLE = { default: { ttl: 60_000, limit: 20 } } as const;

/** Квота загрузок на пользователя по товару за окно (pending + привязанные вложения). */
export const PRODUCT_QA_UPLOAD_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PRODUCT_QA_UPLOAD_QUOTA_MAX = 40;

/** TTL неиспользованных upload до GC (мс). */
export const PRODUCT_QA_PENDING_UPLOAD_TTL_MS = PRODUCT_QA_UPLOAD_QUOTA_WINDOW_MS;

/**
 * Политика S3 для вложений при модерации:
 * - HIDDEN — файлы в S3 сохраняются (можно восстановить на витрину).
 * - DELETED — объекты удаляются из S3; строки ProductQaAttachment остаются в БД.
 */
export const PRODUCT_QA_MODERATION_PURGE_S3_ON_DELETED = true;

/** Socket.IO namespace (см. `product-qa.gateway.ts`). */
export const PRODUCT_QA_SOCKET_NAMESPACE = '/product-qa';

/** Дефолтный топик (миграция и fallback API). */
export const PRODUCT_QA_DEFAULT_TOPIC_SLUG = 'general';
export const PRODUCT_QA_DEFAULT_TOPIC_TITLE = 'Общие вопросы';

export const PRODUCT_QA_TOPIC_SLUG_MAX_CHARS = 64;
export const PRODUCT_QA_TOPIC_TITLE_MAX_CHARS = 120;

/** Вложения в сообщении (после upload). */
export const PRODUCT_QA_ATTACHMENTS_MAX = 4;
export const PRODUCT_QA_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS = 32_768;
export const PRODUCT_QA_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;

export function roomProductQa(productId: string): string {
  return `productQa:${productId}`;
}

/** Приватная комната переписки 1:1 (только JWT + access check). */
export function roomProductCorrespondence(correspondenceId: string): string {
  return `productCorrespondence:${correspondenceId}`;
}

/** WS: новое сообщение в private correspondence. */
export const PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_CREATED = 'correspondence_message_created';

/** Широкая комната staff с доступом catalog (in-app push). */
export const ROOM_STAFF_PRODUCT_QA = 'productQaStaff:catalog';

/** WS: новый вопрос покупателя для staff. */
export const PRODUCT_QA_WS_STAFF_NEW_QUESTION = 'staff_new_question';

/** WS: обновление body публичного Q&A-сообщения. */
export const PRODUCT_QA_WS_MESSAGE_UPDATED = 'message_updated';

/** WS: обновление body сообщения private correspondence. */
export const PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_UPDATED = 'correspondence_message_updated';

/** WS: staff-only pending / pre-mod message for admin live queue. */
export const PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED = 'staff_qa_message_created';

/** WS: staff-only update for non-visible Q&A messages (PENDING / HIDDEN / DELETED). */
export const PRODUCT_QA_WS_STAFF_QA_MESSAGE_UPDATED = 'staff_qa_message_updated';

/** Default page size for admin chat-products inbox. */
export const PRODUCT_QA_CHAT_PRODUCTS_DEFAULT_LIMIT = 50;
export const PRODUCT_QA_CHAT_PRODUCTS_MAX_LIMIT = 100;

/** Pre-mod: USER-post → PENDING; unread staff считает PENDING. Без флага — VISIBLE. */
export function productQaPreModerationEnabled(envValue: string | undefined): boolean {
  const v = envValue?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
