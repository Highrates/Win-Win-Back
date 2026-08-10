import { ProductQaAttachmentKind, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { attachmentKindFromMime, labelQaAuthor, qaAuthorInclude } from '../product-qa/product-qa.mapper';
import type {
  ProductCorrespondenceAttachmentOut,
  ProductCorrespondenceMessageOut,
} from './product-correspondence.types';

export { attachmentKindFromMime };

export function correspondenceMessageInclude() {
  return {
    author: { select: qaAuthorInclude() },
    productVariant: { select: { variantLabel: true } },
    attachments: { orderBy: { sortOrder: 'asc' as const } },
    publishedQaMessage: { select: { status: true } },
  } as const;
}

export function mapCorrespondenceAttachment(a: {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: ProductQaAttachmentKind;
}): ProductCorrespondenceAttachmentOut {
  return {
    id: a.id,
    url: a.url,
    filename: a.filename,
    mimeType: a.mimeType,
    kind: a.kind,
  };
}

export function mapCorrespondenceMessage(m: {
  id: string;
  correspondenceId: string;
  authorUserId: string;
  authorRole: ProductQaAuthorRole;
  body: string;
  productVariantId: string | null;
  publishedQaMessageId: string | null;
  publishedQaMessage?: { status: ProductQaMessageStatus } | null;
  createdAt: Date;
  author: {
    staffDisplayName: string | null;
    staffAvatarUrl: string | null;
    profile: { firstName: string | null; lastName: string | null; avatarUrl: string | null } | null;
  };
  productVariant: { variantLabel: string | null } | null;
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    kind: ProductQaAttachmentKind;
  }>;
  editedAt?: Date | null;
}): ProductCorrespondenceMessageOut {
  const rawAvatar =
    m.authorRole === ProductQaAuthorRole.STAFF
      ? m.author.staffAvatarUrl?.trim()
      : m.author.profile?.avatarUrl?.trim();
  return {
    id: m.id,
    correspondenceId: m.correspondenceId,
    authorUserId: m.authorUserId,
    authorRole: m.authorRole,
    authorLabel: labelQaAuthor(m.authorRole, m.author),
    authorAvatarUrl: rawAvatar && rawAvatar.length > 0 ? rawAvatar : null,
    body: m.body,
    productVariantId: m.productVariantId,
    variantLabel: m.productVariant?.variantLabel?.trim() || null,
    publishedQaMessageId: m.publishedQaMessageId,
    isPublishedToStorefront: m.publishedQaMessage?.status === ProductQaMessageStatus.VISIBLE,
    attachments: m.attachments.map(mapCorrespondenceAttachment),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
  };
}

function previewBody(body: string, max = 140): string {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function previewCorrespondenceBody(body: string): string {
  return previewBody(body);
}
