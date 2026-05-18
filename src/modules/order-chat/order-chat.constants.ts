export const ORDER_CHAT_SOCKET_NAMESPACE = '/order-chat';
export const ROOM_STAFF_ORDER_CHAT = 'staffOrderChat';

/** Размер «хвоста» и страницы «раньше». */
export const CHAT_MESSAGES_PAGE_DEFAULT = 50;
export const CHAT_MESSAGES_PAGE_MAX = 100;

/** Одно текстовое поле сообщения (должен совпадать с dto). */
export const ORDER_CHAT_POST_BODY_MAX_CHARS = 12000;
/** Число вложений-слов в теле после upload. */
export const ORDER_CHAT_ATTACHMENTS_MAX = 12;
/** Суммарная длина fileUrl + filename + mimeType по всем позициям `attachments`. */
export const ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS = 65536;
/** Загрузка одного файла в чат (мультипарт). Раньше 100 МБ — снижено против злоупотреблений. */
export const ORDER_CHAT_UPLOAD_MAX_FILE_BYTES = 35 * 1024 * 1024;

/** Удалить своё сообщение (или другое — для сотрудника) можно только в течение этого окна после `createdAt`. */
export const ORDER_CHAT_DELETE_WITHIN_MS = 24 * 60 * 60 * 1000;

export function roomOrderChat(orderId: string): string {
  return `orderChat:${orderId}`;
}
