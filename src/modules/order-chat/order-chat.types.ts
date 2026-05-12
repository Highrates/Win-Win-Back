import type { ChatAttachmentKind, ChatMessageAuthorRole } from '@prisma/client';

export type OrderChatAttachmentOut = {
  id: string;
  fileUrl: string;
  filename: string;
  mimeType: string | null;
  kind: ChatAttachmentKind;
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
}
