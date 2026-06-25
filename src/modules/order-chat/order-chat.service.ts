import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatAttachmentKind,
  ChatMessageAuthorRole,
  CommercialProposalStatus,
  OrderStatus,
  Prisma,
  SourcingRequestStatus,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MailService } from '../auth/mail.service';
import type { PostOrderChatMessageDto } from './dto/order-chat.dto';
import type {
  OrderChatMessageOut,
  OrderChatRealtimeEmitter,
} from './order-chat.types';
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COMPLETED_STATUSES,
} from '../orders/order-status.constants';
import {
  CHAT_MESSAGES_PAGE_DEFAULT,
  CHAT_MESSAGES_PAGE_MAX,
  ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS,
  ORDER_CHAT_ATTACHMENTS_MAX,
  ORDER_CHAT_DELETE_WITHIN_MS,
  ORDER_CHAT_POST_BODY_MAX_CHARS,
} from './order-chat.constants';

/** Имена из multipart (Multer) иногда приходят как UTF-8, прочитанный как latin1 («Ð...»). */
function decodeUploadOriginalName(original: string | undefined | null): string {
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

@Injectable()
export class OrderChatService {
  private readonly logger = new Logger(OrderChatService.name);
  private gateway: OrderChatRealtimeEmitter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  registerGateway(g: OrderChatRealtimeEmitter): void {
    this.gateway = g;
  }

  retentionDays(): number {
    const raw = this.config.get<string>('ORDER_CHAT_RETENTION_DAYS');
    const n = raw != null && raw !== '' ? Number(raw) : 90;
    return Number.isFinite(n) && n > 0 ? n : 90;
  }

  private async assertOrderNonDraft(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!o) throw new NotFoundException('Заказ не найден');
    if (o.status === OrderStatus.DRAFT) {
      throw new ForbiddenException('Чат недоступен для черновика');
    }
    return o;
  }

  async assertCustomerCanAccess(orderId: string, userId: string): Promise<void> {
    await this.assertOrderNonDraft(orderId);
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!o) throw new ForbiddenException('Нет доступа к заказу');
  }

  async assertStaffCanAccess(orderId: string): Promise<void> {
    await this.assertOrderNonDraft(orderId);
  }

  private async assertConversationActive(orderId: string): Promise<{ id: string } | null> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (conv?.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      throw new ForbiddenException('Срок хранения переписки истёк');
    }
    return conv;
  }

  private authorRoleFromJwt(role: string): ChatMessageAuthorRole {
    return role === UserRole.ADMIN || role === UserRole.MODERATOR
      ? ChatMessageAuthorRole.STAFF
      : ChatMessageAuthorRole.CUSTOMER;
  }

  private labelAuthor(
    role: ChatMessageAuthorRole,
    profile: { firstName: string | null; lastName: string | null } | null,
    email: string | null,
  ): string {
    if (role === ChatMessageAuthorRole.STAFF) {
      const n = [profile?.firstName, profile?.lastName]
        .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
        .join(' ')
        .trim();
      return n || 'Менеджер Win-Win';
    }
    const n = [profile?.firstName, profile?.lastName]
      .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
      .join(' ')
      .trim();
    return n || email?.trim() || 'Клиент';
  }

  private mapMessage(m: {
    id: string;
    conversationId: string;
    authorUserId: string;
    authorRole: ChatMessageAuthorRole;
    body: string;
    deletedAt: Date | null;
    createdAt: Date;
    attachments: {
      id: string;
      fileUrl: string;
      filename: string;
      mimeType: string | null;
      kind: ChatAttachmentKind;
    }[];
    author: {
      email: string | null;
      profile: { firstName: string | null; lastName: string | null; avatarUrl: string | null } | null;
    };
  }): OrderChatMessageOut {
    const deleted = !!m.deletedAt;
    const authorLabel = this.labelAuthor(m.authorRole, m.author.profile, m.author.email);
    const rawAvatar = m.author.profile?.avatarUrl?.trim();
    return {
      id: m.id,
      conversationId: m.conversationId,
      authorUserId: m.authorUserId,
      authorRole: m.authorRole,
      authorLabel,
      authorAvatarUrl: rawAvatar && rawAvatar.length > 0 ? rawAvatar : null,
      body: deleted ? '' : m.body,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      attachments: deleted
        ? []
        : m.attachments.map((a) => ({
            id: a.id,
            fileUrl: a.fileUrl,
            filename: a.filename,
            mimeType: a.mimeType,
            kind: a.kind,
          })),
    };
  }

  /** Ограничение одной порции сообщений («хвост» или блок «старее»). */
  private normalizeMessagesPageLimit(limitRaw?: number): number {
    if (limitRaw != null && Number.isFinite(limitRaw)) {
      const n = Math.floor(limitRaw);
      return Math.min(CHAT_MESSAGES_PAGE_MAX, Math.max(1, n));
    }
    return CHAT_MESSAGES_PAGE_DEFAULT;
  }

  /** Курсор по **`before`** (id сообщения): порция сообщений **строже старее** указанной точки по порядку (createdAt ↑, id ↑). Без курсора — **последние** сообщения («хвост»). Совпадающий `createdAt` разводится вторичным ключом **`id`** (совместимо с порядком `orderBy`). */
  async listMessages(
    orderId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ): Promise<{ conversationId: string | null; messages: OrderChatMessageOut[]; hasOlder: boolean }> {
    const limit = this.normalizeMessagesPageLimit(opts?.limit);

    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv) {
      return { conversationId: null, messages: [], hasOlder: false };
    }
    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      return { conversationId: conv.id, messages: [], hasOlder: false };
    }

    const includePayload = {
      attachments: true,
      author: {
        select: { email: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } },
      },
    } as const;

    let messageWhere: Prisma.ChatMessageWhereInput = { conversationId: conv.id };
    const beforeId = opts?.beforeMessageId?.trim();
    if (beforeId) {
      const anchor = await this.prisma.chatMessage.findFirst({
        where: { id: beforeId, conversationId: conv.id },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      messageWhere = {
        conversationId: conv.id,
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          {
            AND: [{ createdAt: anchor.createdAt }, { id: { lt: anchor.id } }],
          },
        ],
      };
    }

    const takePeek = limit + 1;
    const rowsDesc = await this.prisma.chatMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: takePeek,
      include: includePayload,
    });

    const hasOlder = rowsDesc.length > limit;
    const chronological = rowsDesc.slice(0, limit).reverse();

    return {
      conversationId: conv.id,
      messages: chronological.map((r) => this.mapMessage(r)),
      hasOlder,
    };
  }

  private validateAttachmentKeys(orderId: string, urls: string[]): void {
    const prefix = `objects/chat/orders/${orderId}/`;
    for (const url of urls) {
      const key = this.storage.tryPublicUrlToKey(url);
      if (!key || !key.startsWith(prefix)) {
        throw new BadRequestException('Недопустимый URL вложения');
      }
    }
  }

  private assertAttachmentRefsPayloadLimits(
    att: NonNullable<PostOrderChatMessageDto['attachments']>,
  ): void {
    if (att.length > ORDER_CHAT_ATTACHMENTS_MAX) {
      throw new BadRequestException(
        `Не более ${ORDER_CHAT_ATTACHMENTS_MAX} вложений в одном сообщении`,
      );
    }
    let sum = 0;
    for (const a of att) {
      sum += a.fileUrl.length + a.filename.length + (a.mimeType?.length ?? 0);
    }
    if (sum > ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS) {
      throw new BadRequestException('Слишком большой объём ссылок на вложения в сообщении');
    }
  }

  async postMessage(
    orderId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostOrderChatMessageDto,
  ): Promise<OrderChatMessageOut> {
    await this.assertConversationActive(orderId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccess(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccess(orderId);
    }

    const body = dto.body?.trim() ?? '';
    const att = dto.attachments ?? [];
    if (!body && att.length === 0) {
      throw new BadRequestException('Пустое сообщение');
    }
    if (body.length > ORDER_CHAT_POST_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }
    if (att.length > 0) {
      this.assertAttachmentRefsPayloadLimits(att);
    }

    this.validateAttachmentKeys(
      orderId,
      att.map((a) => a.fileUrl),
    );

    const conv = await this.prisma.chatConversation.upsert({
      where: { orderId },
      create: { kind: 'ORDER', orderId },
      update: {},
      select: { id: true, retentionPurgesAt: true },
    });

    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      throw new ForbiddenException('Срок хранения переписки истёк');
    }

    const row = await this.prisma.chatMessage.create({
      data: {
        conversationId: conv.id,
        authorUserId: jwtUserId,
        authorRole,
        body,
        attachments: {
          create: att.map((a) => ({
            fileUrl: a.fileUrl,
            filename: decodeUploadOriginalName(a.filename).slice(0, 512),
            mimeType: a.mimeType?.slice(0, 128) ?? null,
            kind: a.kind,
          })),
        },
      },
      include: {
        attachments: true,
        author: {
          select: { email: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });

    const out = this.mapMessage(row);
    this.gateway?.broadcastNewMessage(orderId, out);

    void this.notifyEmail(orderId, authorRole, body).catch((e) =>
      this.logger.warn(`order-chat notify mail failed: ${e instanceof Error ? e.message : e}`),
    );

    return out;
  }

  async deleteMessage(orderId: string, messageId: string, jwtUserId: string, jwtRole: string): Promise<void> {
    await this.assertConversationActive(orderId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccess(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccess(orderId);
    }

    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException();

    const msg = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId: conv.id, deletedAt: null },
      select: { id: true, authorUserId: true, authorRole: true, createdAt: true },
    });
    if (!msg) throw new NotFoundException();

    const expiresAtMs = msg.createdAt.getTime() + ORDER_CHAT_DELETE_WITHIN_MS;
    if (Date.now() > expiresAtMs) {
      throw new ForbiddenException('Удалить сообщение можно только в течение 24 часов после отправки');
    }

    const isStaff = authorRole === ChatMessageAuthorRole.STAFF;
    if (!isStaff) {
      if (msg.authorRole !== ChatMessageAuthorRole.CUSTOMER || msg.authorUserId !== jwtUserId) {
        throw new ForbiddenException('Можно удалить только своё сообщение');
      }
    }

    await this.prisma.chatMessage.update({
      where: { id: msg.id },
      data: { deletedAt: new Date(), body: '' },
    });

    this.gateway?.broadcastMessageDeleted(orderId, { id: messageId });
  }

  async markRead(orderId: string, jwtUserId: string, jwtRole: string): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccess(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccess(orderId);
    }

    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!conv) return;

    const now = new Date();
    await this.prisma.chatReadState.upsert({
      where: {
        conversationId_userId: { conversationId: conv.id, userId: jwtUserId },
      },
      create: { conversationId: conv.id, userId: jwtUserId, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  async uploadAttachment(
    orderId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; filename: string; mimeType: string; kind: ChatAttachmentKind }> {
    await this.assertConversationActive(orderId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccess(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccess(orderId);
    }

    const safeName = decodeUploadOriginalName(file.originalname);
    this.storage.assertLibraryFile({
      size: file.size,
      mimetype: file.mimetype,
      originalname: safeName,
    });

    const ext = this.storage.libraryFileExtension(file.mimetype, safeName || 'file');
    const objectKey = `objects/chat/orders/${orderId}/${randomBytes(16).toString('hex')}${ext}`;
    const { url } = await this.storage.uploadMediaLibraryObject(
      file.buffer,
      file.mimetype,
      objectKey,
      safeName,
    );

    const kind: ChatAttachmentKind =
      file.mimetype.startsWith('image/') && file.mimetype !== 'image/tiff'
        ? ChatAttachmentKind.IMAGE
        : ChatAttachmentKind.FILE;

    return {
      url,
      filename: safeName.slice(0, 512),
      mimeType: file.mimetype,
      kind,
    };
  }

  /** Заказы, у которых опубликованная версия КП новее, чем отметка «просмотрено» в ЛК. */
  private async countOrdersWithUnseenPublishedCommercialProposal(
    userId: string,
    orderStatuses?: OrderStatus[],
  ): Promise<number> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(orderStatuses?.length
        ? { status: { in: orderStatuses } }
        : { status: { not: OrderStatus.DRAFT } }),
    };
    const orders = await this.prisma.order.findMany({
      where,
      select: {
        customerLastSeenCommercialProposalVersion: true,
        commercialProposals: {
          where: { status: CommercialProposalStatus.PUBLISHED },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });
    let n = 0;
    for (const o of orders) {
      const latest = o.commercialProposals[0]?.versionNumber;
      if (latest == null) continue;
      const seen = o.customerLastSeenCommercialProposalVersion ?? 0;
      if (latest > seen) n++;
    }
    return n;
  }

  /** Заявки на подбор с непросмотренным опубликованным КП. */
  private async countSourcingWithUnseenPublishedCommercialProposal(
    userId: string,
    sourcingStatuses?: SourcingRequestStatus[],
  ): Promise<number> {
    const rows = await this.prisma.sourcingRequest.findMany({
      where: {
        userId,
        ...(sourcingStatuses?.length ? { status: { in: sourcingStatuses } } : {}),
      },
      select: {
        customerLastSeenCommercialProposalVersion: true,
        commercialProposals: {
          where: { status: CommercialProposalStatus.PUBLISHED },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });
    let n = 0;
    for (const r of rows) {
      const latest = r.commercialProposals[0]?.versionNumber;
      if (latest == null) continue;
      const seen = r.customerLastSeenCommercialProposalVersion ?? 0;
      if (latest > seen) n++;
    }
    return n;
  }

  async unreadCountForCustomer(
    userId: string,
    opts?: { orderStatuses?: OrderStatus[] },
  ): Promise<number> {
    const orderWhere: Prisma.OrderWhereInput = {
      userId,
      ...(opts?.orderStatuses?.length
        ? { status: { in: opts.orderStatuses } }
        : { status: { not: OrderStatus.DRAFT } }),
    };
    const convs = await this.prisma.chatConversation.findMany({
      where: {
        order: orderWhere,
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        readStates: {
          where: { userId },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    let total = 0;
    for (const c of convs) {
      const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
      const n = await this.prisma.chatMessage.count({
        where: {
          conversationId: c.id,
          authorRole: ChatMessageAuthorRole.STAFF,
          deletedAt: null,
          createdAt: { gt: lastRead },
        },
      });
      total += n;
    }

    const sourcingStatuses =
      opts?.orderStatuses?.length
        ? [SourcingRequestStatus.PENDING_REVIEW, SourcingRequestStatus.IN_PROGRESS]
        : undefined;
    const sourcingConvs = await this.prisma.chatConversation.findMany({
      where: {
        sourcingRequest: {
          userId,
          ...(sourcingStatuses ? { status: { in: sourcingStatuses } } : {}),
        },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        readStates: { where: { userId }, select: { lastReadAt: true }, take: 1 },
      },
    });
    for (const c of sourcingConvs) {
      const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
      const n = await this.prisma.chatMessage.count({
        where: {
          conversationId: c.id,
          authorRole: ChatMessageAuthorRole.STAFF,
          deletedAt: null,
          createdAt: { gt: lastRead },
        },
      });
      total += n;
    }

    total += await this.countOrdersWithUnseenPublishedCommercialProposal(userId, opts?.orderStatuses);
    total += await this.countSourcingWithUnseenPublishedCommercialProposal(userId, sourcingStatuses);
    return total;
  }

  /** Непрочитанные сообщения сотрудника по каждому заказу (для списка заказов в ЛК). */
  async unreadStaffCountsForCustomerOrders(
    userId: string,
    orderIds: string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of orderIds) out[id] = 0;
    if (!orderIds.length) return out;

    const convs = await this.prisma.chatConversation.findMany({
      where: {
        orderId: { in: orderIds },
        order: { userId },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        orderId: true,
        readStates: {
          where: { userId },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    await Promise.all(
      convs.map(async (c) => {
        if (!c.orderId) return;
        const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
        const n = await this.prisma.chatMessage.count({
          where: {
            conversationId: c.id,
            authorRole: ChatMessageAuthorRole.STAFF,
            deletedAt: null,
            createdAt: { gt: lastRead },
          },
        });
        out[c.orderId] = n;
      }),
    );

    return out;
  }

  async unreadCountForStaff(staffUserId: string): Promise<number> {
    const convs = await this.prisma.chatConversation.findMany({
      where: {
        order: { status: { not: OrderStatus.DRAFT } },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        readStates: {
          where: { userId: staffUserId },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    let total = 0;
    for (const c of convs) {
      const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
      const n = await this.prisma.chatMessage.count({
        where: {
          conversationId: c.id,
          authorRole: ChatMessageAuthorRole.CUSTOMER,
          deletedAt: null,
          createdAt: { gt: lastRead },
        },
      });
      total += n;
    }
    return total;
  }

  async onOrderStatusChanged(orderId: string, status: OrderStatus): Promise<void> {
    if (status !== OrderStatus.RECEIVED && status !== OrderStatus.COMPLETED) return;
    const exists = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!exists) return;
    const expires = new Date(Date.now() + this.retentionDays() * 86400000);
    await this.prisma.chatConversation.update({
      where: { orderId },
      data: { retentionPurgesAt: expires },
    });
  }

  private async notifyEmail(orderId: string, fromRole: ChatMessageAuthorRole, bodyPreview: string): Promise<void> {
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        user: { select: { email: true, profile: { select: { firstName: true } } } },
      },
    });
    if (!order) return;

    const shortId = `${orderId.slice(0, 4)}…${orderId.slice(-4)}`;
    const snippet = bodyPreview.trim().slice(0, 280) || '(вложение)';

    if (fromRole === ChatMessageAuthorRole.CUSTOMER) {
      const recipients = await this.resolveStaffNotifyEmails();
      if (!recipients.length) return;
      await this.mail.sendOrderChatNotifyStaff({
        recipients,
        orderDisplayId: shortId,
        orderId,
        snippet,
        adminOrderUrl: `${frontBase}/admin/orders/${orderId}#order-chat`,
      });
      return;
    }

    const to = order.user.email?.trim();
    if (!to) return;
    await this.mail.sendOrderChatNotifyCustomer({
      to,
      customerName: order.user.profile?.firstName?.trim() || null,
      orderDisplayId: shortId,
      snippet,
      accountOrdersUrl: `${frontBase}/account/orders`,
    });
  }

  /** Те же адресаты, что и для писем о сообщениях в чате заказа (`ORDER_CHAT_STAFF_EMAIL` или email админов/модераторов). */
  async getStaffNotifyEmailRecipients(): Promise<string[]> {
    return this.resolveStaffNotifyEmails();
  }

  private async resolveStaffNotifyEmails(): Promise<string[]> {
    const raw = this.config.get<string>('ORDER_CHAT_STAFF_EMAIL')?.trim();
    if (raw) {
      return [...new Set(raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean))];
    }
    const rows = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.MODERATOR] },
        email: { not: null },
      },
      select: { email: true },
    });
    return [...new Set(rows.map((r) => r.email!.trim()).filter(Boolean))];
  }

  /** Перед удалением заказа: файлы вложений чата из S3 (БД удалит сообщения каскадом). */
  async purgeOrderChatMediaForOrder(orderId: string): Promise<void> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: {
        messages: { select: { attachments: { select: { fileUrl: true } } } },
      },
    });
    if (!conv?.messages?.length) return;
    for (const m of conv.messages) {
      for (const a of m.attachments) {
        const key = this.storage.tryPublicUrlToKey(a.fileUrl);
        if (key) await this.storage.removeObjectKey(key).catch(() => undefined);
      }
    }
  }

  /** Перед удалением заявки на подбор: файлы вложений чата из S3. */
  async purgeSourcingChatMediaForRequest(sourcingRequestId: string): Promise<void> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: {
        messages: { select: { attachments: { select: { fileUrl: true } } } },
      },
    });
    if (!conv?.messages?.length) return;
    for (const m of conv.messages) {
      for (const a of m.attachments) {
        const key = this.storage.tryPublicUrlToKey(a.fileUrl);
        if (key) await this.storage.removeObjectKey(key).catch(() => undefined);
      }
    }
  }

  /** Непрочитанные сообщения клиента по заказам (для админки). */
  async unreadCustomerCountsForStaffOrders(
    staffUserId: string,
    orderIds: string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of orderIds) out[id] = 0;
    if (!orderIds.length) return out;

    const convs = await this.prisma.chatConversation.findMany({
      where: {
        orderId: { in: orderIds },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        orderId: true,
        readStates: {
          where: { userId: staffUserId },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    await Promise.all(
      convs.map(async (c) => {
        if (!c.orderId) return;
        const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
        const n = await this.prisma.chatMessage.count({
          where: {
            conversationId: c.id,
            authorRole: ChatMessageAuthorRole.CUSTOMER,
            deletedAt: null,
            createdAt: { gt: lastRead },
          },
        });
        out[c.orderId] = n;
      }),
    );

    return out;
  }

  /** Непрочитанные сообщения клиента по заявкам на подбор (для админки). */
  async unreadCustomerCountsForStaffSourcingRequests(
    staffUserId: string,
    sourcingRequestIds: string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of sourcingRequestIds) out[id] = 0;
    if (!sourcingRequestIds.length) return out;

    const convs = await this.prisma.chatConversation.findMany({
      where: {
        sourcingRequestId: { in: sourcingRequestIds },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        sourcingRequestId: true,
        readStates: {
          where: { userId: staffUserId },
          select: { lastReadAt: true },
          take: 1,
        },
      },
    });

    await Promise.all(
      convs.map(async (c) => {
        if (!c.sourcingRequestId) return;
        const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
        const n = await this.prisma.chatMessage.count({
          where: {
            conversationId: c.id,
            authorRole: ChatMessageAuthorRole.CUSTOMER,
            deletedAt: null,
            createdAt: { gt: lastRead },
          },
        });
        out[c.sourcingRequestId] = n;
      }),
    );

    return out;
  }

  /** Сводка непрочитанных от клиента по вкладкам списка заказов в админке. */
  async unreadCustomerChatSummaryForAdminBuckets(staffUserId: string): Promise<{
    total: number;
    new: number;
    active: number;
    completed: number;
  }> {
    const countBucket = async (bucketWhere: Prisma.OrderWhereInput): Promise<number> => {
      const convs = await this.prisma.chatConversation.findMany({
        where: {
          order: { AND: [{ status: { not: OrderStatus.DRAFT } }, bucketWhere] },
          OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
        },
        select: {
          id: true,
          readStates: {
            where: { userId: staffUserId },
            select: { lastReadAt: true },
            take: 1,
          },
        },
      });
      const parts = await Promise.all(
        convs.map(async (c) => {
          const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
          return this.prisma.chatMessage.count({
            where: {
              conversationId: c.id,
              authorRole: ChatMessageAuthorRole.CUSTOMER,
              deletedAt: null,
              createdAt: { gt: lastRead },
            },
          });
        }),
      );
      return parts.reduce((a, b) => a + b, 0);
    };

    const newN = await countBucket({ status: OrderStatus.PENDING_APPROVAL });
    const activeN = await countBucket({ status: { in: [...ADMIN_ACTIVE_STATUSES] } });
    const completedN = await countBucket({ status: { in: [...ADMIN_COMPLETED_STATUSES] } });
    return {
      total: newN + activeN + completedN,
      new: newN,
      active: activeN,
      completed: completedN,
    };
  }

  /** Сводка непрочитанных от клиента по вкладкам списка заявок на подбор в админке. */
  async unreadSourcingCustomerChatSummaryForAdminBuckets(staffUserId: string): Promise<{
    total: number;
    new: number;
    active: number;
    completed: number;
  }> {
    const countBucket = async (
      statuses: SourcingRequestStatus[],
    ): Promise<number> => {
      const convs = await this.prisma.chatConversation.findMany({
        where: {
          sourcingRequestId: { not: null },
          sourcingRequest: { status: { in: statuses } },
          OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
        },
        select: {
          id: true,
          readStates: {
            where: { userId: staffUserId },
            select: { lastReadAt: true },
            take: 1,
          },
        },
      });
      const parts = await Promise.all(
        convs.map(async (c) => {
          const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
          return this.prisma.chatMessage.count({
            where: {
              conversationId: c.id,
              authorRole: ChatMessageAuthorRole.CUSTOMER,
              deletedAt: null,
              createdAt: { gt: lastRead },
            },
          });
        }),
      );
      return parts.reduce((a, b) => a + b, 0);
    };

    const newN = await countBucket([SourcingRequestStatus.PENDING_REVIEW]);
    const activeN = await countBucket([SourcingRequestStatus.IN_PROGRESS]);
    const completedN = await countBucket([
      SourcingRequestStatus.COMPLETED,
      SourcingRequestStatus.CANCELLED,
    ]);
    return {
      total: newN + activeN + completedN,
      new: newN,
      active: activeN,
      completed: completedN,
    };
  }

  async verifyJoinRoom(userId: string, role: string, orderId: string): Promise<void> {
    const ar = this.authorRoleFromJwt(role);
    if (ar === ChatMessageAuthorRole.STAFF) {
      await this.assertStaffCanAccess(orderId);
      return;
    }
    await this.assertCustomerCanAccess(orderId, userId);
  }

  // --- Чат заявок на подбор ---

  async assertSourcingCustomerCanAccess(sourcingRequestId: string, userId: string): Promise<void> {
    const row = await this.prisma.sourcingRequest.findFirst({
      where: { id: sourcingRequestId, userId },
      select: { id: true, status: true },
    });
    if (!row) throw new ForbiddenException('Нет доступа к заявке');
    if (row.status === SourcingRequestStatus.CANCELLED) {
      throw new ForbiddenException('Чат недоступен для отменённой заявки');
    }
  }

  async assertSourcingStaffCanAccess(_sourcingRequestId: string): Promise<void> {
    /* staff: любая заявка */
  }

  private async assertSourcingConversationActive(
    sourcingRequestId: string,
  ): Promise<{ id: string } | null> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (conv?.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      throw new ForbiddenException('Срок хранения переписки истёк');
    }
    return conv;
  }

  private validateSourcingAttachmentKeys(sourcingRequestId: string, urls: string[]): void {
    const prefix = `objects/chat/sourcing-requests/${sourcingRequestId}/`;
    for (const url of urls) {
      const key = this.storage.tryPublicUrlToKey(url);
      if (!key || !key.startsWith(prefix)) {
        throw new BadRequestException('Недопустимый URL вложения');
      }
    }
  }

  async ensureSourcingConversation(sourcingRequestId: string): Promise<void> {
    await this.prisma.chatConversation.upsert({
      where: { sourcingRequestId },
      create: { kind: 'SOURCING', sourcingRequestId },
      update: {},
    });
  }

  async listSourcingMessagesForStaff(
    sourcingRequestId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ) {
    await this.assertSourcingStaffCanAccess(sourcingRequestId);
    return this.listSourcingMessagesInternal(sourcingRequestId, opts);
  }

  async listSourcingMessages(
    sourcingRequestId: string,
    jwtUserId: string,
    jwtRole: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ) {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertSourcingCustomerCanAccess(sourcingRequestId, jwtUserId);
    } else {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
    }
    return this.listSourcingMessagesInternal(sourcingRequestId, opts);
  }

  private async listSourcingMessagesInternal(
    sourcingRequestId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ) {
    const limit = this.normalizeMessagesPageLimit(opts?.limit);
    let conv = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv) {
      await this.ensureSourcingConversation(sourcingRequestId);
      conv = await this.prisma.chatConversation.findUnique({
        where: { sourcingRequestId },
        select: { id: true, retentionPurgesAt: true },
      });
    }
    if (!conv) {
      return { conversationId: null, messages: [], hasOlder: false };
    }
    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      return { conversationId: conv.id, messages: [], hasOlder: false };
    }

    const includePayload = {
      attachments: true,
      author: {
        select: { email: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } },
      },
    } as const;

    let messageWhere: Prisma.ChatMessageWhereInput = { conversationId: conv.id };
    const beforeId = opts?.beforeMessageId?.trim();
    if (beforeId) {
      const anchor = await this.prisma.chatMessage.findFirst({
        where: { id: beforeId, conversationId: conv.id },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      messageWhere = {
        conversationId: conv.id,
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { AND: [{ createdAt: anchor.createdAt }, { id: { lt: anchor.id } }] },
        ],
      };
    }

    const takePeek = limit + 1;
    const rowsDesc = await this.prisma.chatMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: takePeek,
      include: includePayload,
    });
    const hasOlder = rowsDesc.length > limit;
    const chronological = rowsDesc.slice(0, limit).reverse();
    return {
      conversationId: conv.id,
      messages: chronological.map((r) => this.mapMessage(r)),
      hasOlder,
    };
  }

  async postSourcingMessage(
    sourcingRequestId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostOrderChatMessageDto,
  ) {
    await this.assertSourcingConversationActive(sourcingRequestId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertSourcingCustomerCanAccess(sourcingRequestId, jwtUserId);
    } else {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
    }

    const body = dto.body?.trim() ?? '';
    const att = dto.attachments ?? [];
    if (!body && att.length === 0) throw new BadRequestException('Пустое сообщение');
    if (body.length > ORDER_CHAT_POST_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }
    if (att.length > 0) this.assertAttachmentRefsPayloadLimits(att);
    this.validateSourcingAttachmentKeys(
      sourcingRequestId,
      att.map((a) => a.fileUrl),
    );

    const conv = await this.prisma.chatConversation.upsert({
      where: { sourcingRequestId },
      create: { kind: 'SOURCING', sourcingRequestId },
      update: {},
      select: { id: true, retentionPurgesAt: true },
    });
    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      throw new ForbiddenException('Срок хранения переписки истёк');
    }

    const row = await this.prisma.chatMessage.create({
      data: {
        conversationId: conv.id,
        authorUserId: jwtUserId,
        authorRole,
        body,
        attachments: {
          create: att.map((a) => ({
            fileUrl: a.fileUrl,
            filename: decodeUploadOriginalName(a.filename).slice(0, 512),
            mimeType: a.mimeType?.slice(0, 128) ?? null,
            kind: a.kind,
          })),
        },
      },
      include: {
        attachments: true,
        author: {
          select: { email: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });

    const out = this.mapMessage(row);
    this.gateway?.broadcastSourcingNewMessage(sourcingRequestId, out);
    void this.notifySourcingEmail(sourcingRequestId, authorRole, body).catch((e) =>
      this.logger.warn(`sourcing-chat notify mail failed: ${e instanceof Error ? e.message : e}`),
    );
    return out;
  }

  async deleteSourcingMessage(
    sourcingRequestId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
  ): Promise<void> {
    await this.assertSourcingConversationActive(sourcingRequestId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertSourcingCustomerCanAccess(sourcingRequestId, jwtUserId);
    } else {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
    }

    const conv = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException();

    const msg = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId: conv.id, deletedAt: null },
    });
    if (!msg) throw new NotFoundException();
    const within =
      Date.now() - msg.createdAt.getTime() <= ORDER_CHAT_DELETE_WITHIN_MS;
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      if (msg.authorUserId !== jwtUserId) throw new ForbiddenException();
      if (!within) throw new ForbiddenException('Время удаления истекло');
    }

    await this.prisma.chatMessage.update({
      where: { id: msg.id },
      data: { deletedAt: new Date(), body: '' },
    });
    this.gateway?.broadcastSourcingMessageDeleted(sourcingRequestId, { id: messageId });
  }

  async markSourcingRead(sourcingRequestId: string, jwtUserId: string, jwtRole: string): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertSourcingCustomerCanAccess(sourcingRequestId, jwtUserId);
    } else {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: { id: true },
    });
    if (!conv) return;
    const now = new Date();
    await this.prisma.chatReadState.upsert({
      where: { conversationId_userId: { conversationId: conv.id, userId: jwtUserId } },
      create: { conversationId: conv.id, userId: jwtUserId, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  async uploadSourcingAttachment(
    sourcingRequestId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ) {
    await this.assertSourcingConversationActive(sourcingRequestId);
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertSourcingCustomerCanAccess(sourcingRequestId, jwtUserId);
    } else {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
    }

    const safeName = decodeUploadOriginalName(file.originalname);
    this.storage.assertLibraryFile({
      size: file.size,
      mimetype: file.mimetype,
      originalname: safeName,
    });
    const ext = this.storage.libraryFileExtension(file.mimetype, safeName || 'file');
    const objectKey = `objects/chat/sourcing-requests/${sourcingRequestId}/${randomBytes(16).toString('hex')}${ext}`;
    const { url } = await this.storage.uploadMediaLibraryObject(
      file.buffer,
      file.mimetype,
      objectKey,
      safeName,
    );
    const kind: ChatAttachmentKind =
      file.mimetype.startsWith('image/') && file.mimetype !== 'image/tiff'
        ? ChatAttachmentKind.IMAGE
        : ChatAttachmentKind.FILE;
    return { url, filename: safeName.slice(0, 512), mimeType: file.mimetype, kind };
  }

  async verifyJoinSourcingRoom(userId: string, role: string, sourcingRequestId: string): Promise<void> {
    const ar = this.authorRoleFromJwt(role);
    if (ar === ChatMessageAuthorRole.STAFF) {
      await this.assertSourcingStaffCanAccess(sourcingRequestId);
      return;
    }
    await this.assertSourcingCustomerCanAccess(sourcingRequestId, userId);
  }

  async unreadStaffCountsForCustomerSourcingRequests(
    userId: string,
    sourcingRequestIds: string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of sourcingRequestIds) out[id] = 0;
    if (!sourcingRequestIds.length) return out;

    const convs = await this.prisma.chatConversation.findMany({
      where: {
        sourcingRequestId: { in: sourcingRequestIds },
        sourcingRequest: { userId },
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        sourcingRequestId: true,
        readStates: { where: { userId }, select: { lastReadAt: true }, take: 1 },
      },
    });

    await Promise.all(
      convs.map(async (c) => {
        if (!c.sourcingRequestId) return;
        const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
        const n = await this.prisma.chatMessage.count({
          where: {
            conversationId: c.id,
            authorRole: ChatMessageAuthorRole.STAFF,
            deletedAt: null,
            createdAt: { gt: lastRead },
          },
        });
        out[c.sourcingRequestId] = n;
      }),
    );
    return out;
  }

  async onSourcingStatusChanged(sourcingRequestId: string, status: SourcingRequestStatus): Promise<void> {
    if (status !== SourcingRequestStatus.COMPLETED && status !== SourcingRequestStatus.CANCELLED) return;
    const exists = await this.prisma.chatConversation.findUnique({
      where: { sourcingRequestId },
      select: { id: true },
    });
    if (!exists) return;
    const expires = new Date(Date.now() + this.retentionDays() * 86400000);
    await this.prisma.chatConversation.update({
      where: { sourcingRequestId },
      data: { retentionPurgesAt: expires },
    });
  }

  private async notifySourcingEmail(
    sourcingRequestId: string,
    fromRole: ChatMessageAuthorRole,
    bodyPreview: string,
  ): Promise<void> {
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    const row = await this.prisma.sourcingRequest.findUnique({
      where: { id: sourcingRequestId },
      select: {
        id: true,
        title: true,
        user: { select: { email: true, profile: { select: { firstName: true } } } },
      },
    });
    if (!row) return;

    const shortId = `${sourcingRequestId.slice(0, 4)}…${sourcingRequestId.slice(-4)}`;
    const snippet = bodyPreview.trim().slice(0, 280) || '(вложение)';

    if (fromRole === ChatMessageAuthorRole.CUSTOMER) {
      const recipients = await this.resolveStaffNotifyEmails();
      if (!recipients.length) return;
      await this.mail.sendOrderChatNotifyStaff({
        recipients,
        orderDisplayId: shortId,
        orderId: sourcingRequestId,
        snippet,
        adminOrderUrl: `${frontBase}/admin/orders/sourcing/${sourcingRequestId}`,
      });
      return;
    }

    const to = row.user.email?.trim();
    if (!to) return;
    await this.mail.sendOrderChatNotifyCustomer({
      to,
      customerName: row.user.profile?.firstName?.trim() || null,
      orderDisplayId: shortId,
      snippet,
      accountOrdersUrl: `${frontBase}/account/orders?tab=work`,
    });
  }
}
