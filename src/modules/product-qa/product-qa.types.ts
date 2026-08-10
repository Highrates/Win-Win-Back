import { ProductQaAttachmentKind, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';

export type ProductQaAttachmentOut = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: ProductQaAttachmentKind;
};

export type ProductQaMessageOut = {
  id: string;
  threadId: string;
  topicSlug: string;
  topicTitle: string;
  authorUserId: string;
  authorRole: ProductQaAuthorRole;
  authorLabel: string;
  authorAvatarUrl: string | null;
  body: string;
  productVariantId: string | null;
  variantLabel: string | null;
  status: ProductQaMessageStatus;
  replyToMessageId: string | null;
  replyToPreview: string | null;
  attachments: ProductQaAttachmentOut[];
  createdAt: string;
  editedAt: string | null;
};

export type ProductQaMessageRevisionOut = {
  id: string;
  body: string;
  editedByUserId: string;
  editedByLabel: string;
  createdAt: string;
};

export type ProductQaTopicOut = {
  id: string;
  slug: string;
  title: string;
  messageCount: number;
  isDefault: boolean;
  sortOrder: number;
};

export type ProductQaMetaOut = {
  /** Сумма публичных сообщений по всем топикам (для счётчика PDP / каталога). */
  messageCount: number;
  /** @deprecated используйте topics[].id */
  threadId: string | null;
  topics: ProductQaTopicOut[];
  /** USER-post уходит на модерацию перед публикацией. */
  preModerationEnabled?: boolean;
};

export type ProductQaMessagesListOut = {
  threadId: string | null;
  topicSlug: string;
  messages: ProductQaMessageOut[];
  hasOlder: boolean;
};

export type ProductQaRealtimeEmitter = {
  broadcastMessageCreated(productId: string, payload: ProductQaMessageOut): void;
  broadcastMessageHidden(productId: string, payload: { id: string }): void;
  broadcastMessageUpdated(productId: string, payload: ProductQaMessageOut): void;
  broadcastMetaUpdated(productId: string, payload: ProductQaMetaOut): void;
  broadcastStaffNewQuestion(payload: ProductQaStaffNewQuestionOut): void;
};

export type ProductQaStaffNewQuestionOut = {
  productId: string;
  productSlug: string;
  productName: string;
  messageId: string;
  topicSlug: string;
  topicTitle: string;
  preview: string;
};

export type ProductQaMyProductItemOut = {
  productId: string;
  productSlug: string;
  productName: string;
  productImageUrl: string | null;
  isProductActive: boolean;
  topicSlug: string;
  topicTitle: string;
  myMessageCount: number;
  pendingCount: number;
  hasStaffReply: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
};

export type ProductQaMyProductsListOut = {
  items: ProductQaMyProductItemOut[];
};

export type ProductQaPendingSummaryItemOut = {
  productId: string;
  productSlug: string;
  productName: string;
  publicQaPending: number;
  correspondenceAwaitingPublish: number;
};

export type ProductQaPendingSummaryOut = {
  total: number;
  publicQaPending: number;
  correspondenceAwaitingPublish: number;
  byProduct: ProductQaPendingSummaryItemOut[];
};

export type ProductQaChatProductItemOut = {
  productId: string;
  productSlug: string;
  productName: string;
  productImageUrl: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  publicQaPending: number;
  correspondenceAwaitingPublish: number;
  awaitingStaffReply: boolean;
};

export type ProductQaChatProductsListOut = {
  items: ProductQaChatProductItemOut[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type ProductQaAttachmentRefInput = {
  url: string;
  filename: string;
  mimeType: string;
  kind?: ProductQaAttachmentKind;
};

export type ProductQaAttachmentRef = {
  url: string;
  filename: string;
  mimeType: string;
  kind: ProductQaAttachmentKind;
};
