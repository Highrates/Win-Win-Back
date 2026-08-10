import { ProductQaAttachmentKind, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import type { ProductQaAttachmentOut, ProductQaMessageOut, ProductQaTopicOut } from './product-qa.types';

/** Серверный kind по mime — не доверяем клиенту. */
export function attachmentKindFromMime(mimeType: string): ProductQaAttachmentKind {
  const mime = mimeType.trim().toLowerCase();
  return mime.startsWith('image/') && mime !== 'image/tiff'
    ? ProductQaAttachmentKind.IMAGE
    : ProductQaAttachmentKind.FILE;
}

export function qaAuthorInclude() {
  return {
    staffDisplayName: true,
    staffAvatarUrl: true,
    profile: { select: { firstName: true, lastName: true, avatarUrl: true } },
  } as const;
}

export function qaMessageInclude() {
  return {
    author: { select: qaAuthorInclude() },
    productVariant: { select: { variantLabel: true } },
    thread: { select: { slug: true, title: true } },
    attachments: { orderBy: { sortOrder: 'asc' as const } },
    replyTo: {
      select: {
        id: true,
        body: true,
        authorRole: true,
        author: { select: qaAuthorInclude() },
      },
    },
  } as const;
}

export function mapQaAttachment(a: {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: ProductQaAttachmentKind;
}): ProductQaAttachmentOut {
  return {
    id: a.id,
    url: a.url,
    filename: a.filename,
    mimeType: a.mimeType,
    kind: a.kind,
  };
}

export function labelQaAuthor(
  role: ProductQaAuthorRole,
  author: {
    staffDisplayName?: string | null;
    profile: { firstName: string | null; lastName: string | null } | null;
  },
): string {
  if (role === ProductQaAuthorRole.STAFF) {
    return author.staffDisplayName?.trim() || 'Администратор Win-Win';
  }
  const n = [author.profile?.firstName, author.profile?.lastName]
    .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
    .join(' ')
    .trim();
  return n || 'Пользователь';
}

function previewReplyBody(body: string, max = 120): string {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function mapQaMessage(m: {
  id: string;
  threadId: string;
  authorUserId: string;
  authorRole: ProductQaAuthorRole;
  body: string;
  productVariantId: string | null;
  status: ProductQaMessageStatus;
  replyToMessageId?: string | null;
  createdAt: Date;
  author: {
    staffDisplayName: string | null;
    staffAvatarUrl: string | null;
    profile: { firstName: string | null; lastName: string | null; avatarUrl: string | null } | null;
  };
  productVariant: { variantLabel: string | null } | null;
  thread: { slug: string; title: string };
  replyTo?: {
    id: string;
    body: string;
    authorRole: ProductQaAuthorRole;
    author: {
      staffDisplayName: string | null;
      profile: { firstName: string | null; lastName: string | null } | null;
    };
  } | null;
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    kind: ProductQaAttachmentKind;
  }>;
  editedAt?: Date | null;
}): ProductQaMessageOut {
  const rawAvatar =
    m.authorRole === ProductQaAuthorRole.STAFF
      ? m.author.staffAvatarUrl?.trim()
      : m.author.profile?.avatarUrl?.trim();
  return {
    id: m.id,
    threadId: m.threadId,
    topicSlug: m.thread.slug,
    topicTitle: m.thread.title,
    authorUserId: m.authorUserId,
    authorRole: m.authorRole,
    authorLabel: labelQaAuthor(m.authorRole, m.author),
    authorAvatarUrl: rawAvatar && rawAvatar.length > 0 ? rawAvatar : null,
    body: m.body,
    productVariantId: m.productVariantId,
    variantLabel: m.productVariant?.variantLabel?.trim() || null,
    status: m.status,
    replyToMessageId: m.replyToMessageId ?? null,
    replyToPreview: m.replyTo ? previewReplyBody(m.replyTo.body) : null,
    attachments: m.attachments.map(mapQaAttachment),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
  };
}

export function mapQaTopic(t: {
  id: string;
  slug: string;
  title: string;
  messageCountPublic: number;
  isDefault: boolean;
  sortOrder: number;
}): ProductQaTopicOut {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    messageCount: Math.max(0, t.messageCountPublic),
    isDefault: t.isDefault,
    sortOrder: t.sortOrder,
  };
}

export function decodeQaUploadOriginalName(original: string | undefined | null): string {
  const raw = (original ?? 'file').trim() || 'file';
  if (!/[ÐÑÂâ€]/.test(raw)) return raw.slice(0, 512);
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\ufffd')) return fixed.slice(0, 512);
  } catch {
    /* ignore */
  }
  return raw.slice(0, 512);
}
