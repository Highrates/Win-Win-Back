import type { ChatAttachmentKind, ChatMessageAuthorRole } from '@prisma/client';

/** Без адреса хранилища: файл открывается по `chat:<id>` через GET /files/:ref. */
export type OrderChatAttachmentOut = {
  id: string;
  filename: string;
  mimeType: string | null;
  kind: ChatAttachmentKind;
  /** Откроется в браузере (PDF, текст, картинки); иначе скачается. */
  inline: boolean;
};

export type OrderChatMessageOut = {
  id: string;
  conversationId: string;
  authorUserId: string;
  authorRole: ChatMessageAuthorRole;
  authorLabel: string;
  /** URL аватара из профиля автора (как в ЛК /account/profile) */
  authorAvatarUrl: string | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  attachments: OrderChatAttachmentOut[];
};

export interface OrderChatRealtimeEmitter {
  broadcastNewMessage(orderId: string, payload: OrderChatMessageOut): void;
  broadcastMessageDeleted(orderId: string, payload: { id: string }): void;
  broadcastSourcingNewMessage(sourcingRequestId: string, payload: OrderChatMessageOut): void;
  broadcastSourcingMessageDeleted(sourcingRequestId: string, payload: { id: string }): void;
}
