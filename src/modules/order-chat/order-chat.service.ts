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
  OrderStatus,
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

const MAX_MESSAGES_PAGE = 300;

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
      return n || 'Поддержка Win-Win';
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

  async listMessages(
    orderId: string,
  ): Promise<{ conversationId: string | null; messages: OrderChatMessageOut[] }> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv) return { conversationId: null, messages: [] };
    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      return { conversationId: conv.id, messages: [] };
    }

    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: MAX_MESSAGES_PAGE,
      include: {
        attachments: true,
        author: {
          select: { email: true, profile: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });

    return {
      conversationId: conv.id,
      messages: rows.map((r) => this.mapMessage(r)),
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
            filename: a.filename.slice(0, 512),
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
      select: { id: true, authorUserId: true, authorRole: true },
    });
    if (!msg) throw new NotFoundException();

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

    this.storage.assertLibraryFile({
      size: file.size,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });

    const ext = this.storage.libraryFileExtension(file.mimetype, file.originalname || 'file');
    const objectKey = `objects/chat/orders/${orderId}/${randomBytes(16).toString('hex')}${ext}`;
    const { url } = await this.storage.uploadMediaLibraryObject(
      file.buffer,
      file.mimetype,
      objectKey,
      file.originalname || 'file',
    );

    const kind: ChatAttachmentKind =
      file.mimetype.startsWith('image/') && file.mimetype !== 'image/tiff'
        ? ChatAttachmentKind.IMAGE
        : ChatAttachmentKind.FILE;

    return {
      url,
      filename: (file.originalname || 'file').slice(0, 512),
      mimeType: file.mimetype,
      kind,
    };
  }

  async unreadCountForCustomer(userId: string): Promise<number> {
    const convs = await this.prisma.chatConversation.findMany({
      where: {
        order: { userId, status: { not: OrderStatus.DRAFT } },
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
    return total;
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
    if (status !== OrderStatus.RECEIVED) return;
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

  async verifyJoinRoom(userId: string, role: string, orderId: string): Promise<void> {
    const ar = this.authorRoleFromJwt(role);
    if (ar === ChatMessageAuthorRole.STAFF) {
      await this.assertStaffCanAccess(orderId);
      return;
    }
    await this.assertCustomerCanAccess(orderId, userId);
  }
}
