import { ProductQaAttachmentKind, ProductQaAuthorRole } from '@prisma/client';

export type ProductCorrespondenceAttachmentOut = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: ProductQaAttachmentKind;
};

export type ProductCorrespondenceMessageOut = {
  id: string;
  correspondenceId: string;
  authorUserId: string;
  authorRole: ProductQaAuthorRole;
  authorLabel: string;
  authorAvatarUrl: string | null;
  body: string;
  productVariantId: string | null;
  variantLabel: string | null;
  publishedQaMessageId: string | null;
  isPublishedToStorefront: boolean;
  attachments: ProductCorrespondenceAttachmentOut[];
  createdAt: string;
  editedAt: string | null;
};

export type ProductCorrespondenceMessageRevisionOut = {
  id: string;
  body: string;
  editedByUserId: string;
  editedByLabel: string;
  createdAt: string;
};

export type ProductCorrespondenceMessagesListOut = {
  correspondenceId: string;
  productId: string;
  customerUserId: string;
  messages: ProductCorrespondenceMessageOut[];
  hasOlder: boolean;
};

export type ProductCorrespondenceMyProductItemOut = {
  productId: string;
  productSlug: string;
  productName: string;
  productImageUrl: string | null;
  isProductActive: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
  hasStaffReply: boolean;
  /** Последнее сообщение в переписке — от покупателя (ждём ответ staff). */
  awaitingStaffReply: boolean;
};

export type ProductCorrespondenceMyProductsListOut = {
  items: ProductCorrespondenceMyProductItemOut[];
};

export type ProductCorrespondenceThreadOut = {
  correspondenceId: string;
  customerUserId: string;
  customerLabel: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unpublishedCount: number;
};

export type ProductCorrespondenceThreadsListOut = {
  items: ProductCorrespondenceThreadOut[];
};

export type ProductCorrespondencePublishPairOut = {
  question: ProductCorrespondenceMessageOut;
  answer: ProductCorrespondenceMessageOut;
};
