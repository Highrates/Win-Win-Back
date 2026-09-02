import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SourcingRequestStatus, AuditAction, CommercialProposalStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { priceToNumber } from '../../meilisearch/product-search-doc';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../auth/mail.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import { assertSourcingStatusTransition } from './sourcing-status.constants';
import { adminBucketStatuses, userScopeStatuses, resolveSourcingProductStoredName } from '@win-win/sourcing-request';
import {
  createdAtInRange,
  parseDashboardDateRange,
} from '../../common/utils/dashboard-date-range';
import {
  parseBudgetDigits as parseBudgetDigitsRaw,
  sourcingCommercialProposalOfferTotalRub,
} from '@win-win/sourcing-request';
import {
  parseCreateSourcingRequestPayload,
  type CreateSourcingRequestPayload,
} from './dto/create-sourcing-request.dto';
import {
  clampSourcingListLimit,
  clampSourcingListPage,
  SOURCING_FILE_MAX_BYTES,
} from './sourcing-limits.constants';
import {
  assertSourcingUploadTotalSize,
  cleanupSourcingTempUploads,
} from './sourcing-upload.config';

const SOURCING_FILE_MAX = SOURCING_FILE_MAX_BYTES;

type SourcingCpLineForOffer = {
  quantity: number;
  offerUnitPrice: unknown;
};

function sourcingCommercialProposalOfferFromLines(
  lines: SourcingCpLineForOffer[] | null | undefined,
): { oldTotalRub: number; newTotalRub: number; avgDiscountPercent: number } | null {
  if (!lines?.length) return null;
  const total = sourcingCommercialProposalOfferTotalRub(
    lines.map((l) => ({ quantity: l.quantity, offerUnitPrice: priceToNumber(l.offerUnitPrice) })),
  );
  if (total == null) return null;
  return { oldTotalRub: total, newTotalRub: total, avgDiscountPercent: 0 };
}

function parseBudgetDigits(raw: string | undefined): Prisma.Decimal | null {
  const digits = raw?.trim() ? parseBudgetDigitsRaw(raw) : '';
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Prisma.Decimal(digits);
}

function decodeUploadOriginalName(original: string | undefined | null): string {
  if (!original?.trim()) return 'file';
  try {
    return decodeURIComponent(original.replace(/\+/g, ' '));
  } catch {
    return original;
  }
}

function assertAllReferencedFilesPresent(
  payload: CreateSourcingRequestPayload,
  fileMap: Map<string, Express.Multer.File>,
): void {
  for (let i = 0; i < payload.products.length; i++) {
    for (const key of payload.products[i]!.referenceImageKeys ?? []) {
      if (!fileMap.has(key)) {
        throw new BadRequestException(`Товар ${i + 1}: файл «${key}» не загружен`);
      }
    }
  }
  for (const key of payload.attachmentKeys ?? []) {
    if (!fileMap.has(key)) {
      throw new BadRequestException(`Вложение «${key}» не загружено`);
    }
  }
}

@Injectable()
export class SourcingRequestsService {
  private readonly logger = new Logger(SourcingRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly orderChat: OrderChatService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async createForUser(userId: string, payloadRaw: string, files: Express.Multer.File[]) {
    assertSourcingUploadTotalSize(files);
    const payload = parseCreateSourcingRequestPayload(payloadRaw);
    const fileMap = new Map<string, Express.Multer.File>();
    for (const file of files) {
      if (file?.fieldname) fileMap.set(file.fieldname, file);
    }
    assertAllReferencedFilesPresent(payload, fileMap);

    const requestId = randomBytes(12).toString('hex');
    const itemIds = payload.products.map(() => randomBytes(12).toString('hex'));
    const uploadedObjectKeys: string[] = [];

    type UploadedRef = {
      itemIndex: number;
      sortOrder: number;
      url: string;
      filename: string;
      mimeType: string;
    };
    type UploadedAttachment = {
      sortOrder: number;
      url: string;
      filename: string;
      mimeType: string;
    };

    const referenceUploads: UploadedRef[] = [];
    const attachmentUploads: UploadedAttachment[] = [];
    let dbCommitted = false;

    try {
      for (let i = 0; i < payload.products.length; i++) {
        const product = payload.products[i]!;
        const itemId = itemIds[i]!;
        const keys = product.referenceImageKeys ?? [];
        for (let sortOrder = 0; sortOrder < keys.length; sortOrder++) {
          const key = keys[sortOrder]!;
          const file = fileMap.get(key)!;
          const uploaded = await this.uploadFile(
            file,
            `objects/sourcing-requests/${requestId}/items/${itemId}`,
          );
          uploadedObjectKeys.push(uploaded.objectKey);
          referenceUploads.push({
            itemIndex: i,
            sortOrder,
            url: uploaded.url,
            filename: uploaded.filename,
            mimeType: uploaded.mimeType,
          });
        }
      }

      for (let sortOrder = 0; sortOrder < (payload.attachmentKeys?.length ?? 0); sortOrder++) {
        const key = payload.attachmentKeys![sortOrder]!;
        const file = fileMap.get(key)!;
        const uploaded = await this.uploadFile(
          file,
          `objects/sourcing-requests/${requestId}/attachments`,
        );
        uploadedObjectKeys.push(uploaded.objectKey);
        attachmentUploads.push({
          sortOrder,
          url: uploaded.url,
          filename: uploaded.filename,
          mimeType: uploaded.mimeType,
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.sourcingRequest.create({
          data: {
            id: requestId,
            userId,
            title: payload.title,
            deliveryCity: payload.deliveryCity ?? null,
            items: {
              create: payload.products.map((p, sortOrder) => ({
                id: itemIds[sortOrder],
                sortOrder,
                name: resolveSourcingProductStoredName({
                  name: p.name,
                  requestTitle: payload.title,
                  productIndex: sortOrder,
                  productCount: payload.products.length,
                }),
                productLink: p.productLink || null,
                material: p.material || null,
                color: p.color || null,
                size: p.size || null,
                description: p.description || null,
                quantity: p.quantity,
                unit: p.unit,
                expectedBudget: parseBudgetDigits(p.expectedBudget),
              })),
            },
          },
        });

        for (const ref of referenceUploads) {
          await tx.sourcingRequestItemImage.create({
            data: {
              itemId: itemIds[ref.itemIndex]!,
              url: ref.url,
              filename: ref.filename,
              mimeType: ref.mimeType,
              sortOrder: ref.sortOrder,
            },
          });
        }

        for (const att of attachmentUploads) {
          await tx.sourcingRequestAttachment.create({
            data: {
              requestId,
              url: att.url,
              filename: att.filename,
              mimeType: att.mimeType,
              sortOrder: att.sortOrder,
            },
          });
        }
      });

      dbCommitted = true;

      void this.ensureSourcingConversationWithRetry(requestId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sourcing submit: ensure conversation failed after retries: ${msg}`);
      });

      void this.notifyStaffSourcingSubmitted(requestId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sourcing submit: staff email notify failed: ${msg}`);
      });

      return this.findOneDetailForUser(userId, requestId);
    } catch (err) {
      if (!dbCommitted) {
        await this.cleanupUploadedObjectKeys(uploadedObjectKeys);
      }
      throw err;
    } finally {
      await cleanupSourcingTempUploads(files);
    }
  }

  private async cleanupUploadedObjectKeys(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await Promise.allSettled(keys.map((key) => this.storage.removeObjectKey(key)));
  }

  /** Идемпотентный upsert чата; не блокирует ответ клиенту при create. */
  private async ensureSourcingConversationWithRetry(requestId: string): Promise<void> {
    const retryDelaysMs = [0, 500, 2000, 5000];
    let lastErr: unknown;
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.orderChat.ensureSourcingConversation(requestId);
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sourcing ensure conversation attempt failed: ${msg}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async readUploadBytes(file: Express.Multer.File): Promise<Buffer> {
    if (file.buffer?.length) return file.buffer;
    if (file.path) return readFile(file.path);
    throw new BadRequestException(`Файл «${file.originalname}» пустой`);
  }

  private async uploadFile(file: Express.Multer.File, keyPrefix: string) {
    const buffer = await this.readUploadBytes(file);
    if (buffer.length > SOURCING_FILE_MAX) {
      throw new BadRequestException(`Файл «${file.originalname}» слишком большой`);
    }
    const safeName = decodeUploadOriginalName(file.originalname);
    this.storage.assertLibraryFile({
      size: buffer.length,
      mimetype: file.mimetype,
      originalname: safeName,
    });
    const ext = this.storage.libraryFileExtension(file.mimetype, safeName || 'file');
    const objectKey = `${keyPrefix}/${randomBytes(16).toString('hex')}${ext}`;
    const { url } = await this.storage.uploadMediaLibraryObject(
      buffer,
      file.mimetype,
      objectKey,
      safeName,
    );
    return {
      url,
      filename: safeName.slice(0, 512),
      mimeType: file.mimetype,
      objectKey,
    };
  }

  async findByUser(userId: string, page: number, limit: number, scope?: string) {
    const pageNum = clampSourcingListPage(page);
    const take = clampSourcingListLimit(limit);
    const statuses = userScopeStatuses(scope);
    const where: Prisma.SourcingRequestWhereInput = {
      userId,
      ...(statuses ? { status: { in: [...statuses] as SourcingRequestStatus[] } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.sourcingRequest.count({ where }),
      this.prisma.sourcingRequest.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (pageNum - 1) * take,
        take,
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              referenceImages: { orderBy: { sortOrder: 'asc' } },
            },
          },
          commercialProposals: {
            where: { status: CommercialProposalStatus.PUBLISHED },
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: {
              versionNumber: true,
              publishedAt: true,
              lines: {
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                select: {
                  quantity: true,
                  offerUnitPrice: true,
                  deliveryEta: true,
                  images: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    const unreadStaffById = await this.orderChat.unreadStaffCountsForCustomerSourcingRequests(
      userId,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => {
        const { commercialProposals, ...rawRow } = r;
        const latest = commercialProposals[0];
        const commercialProposalOffer = latest?.lines?.length
          ? sourcingCommercialProposalOfferFromLines(latest.lines)
          : null;
        const deliveryEtas = (latest?.lines ?? [])
          .map((l) => (typeof l.deliveryEta === 'string' ? l.deliveryEta.trim() : ''))
          .filter(Boolean);
        const commercialProposalDeliveryEta = deliveryEtas.length ? deliveryEtas.join(' · ') : null;
        const commercialProposalImageUrls = (latest?.lines ?? []).flatMap((l) =>
          (l.images ?? []).map((img) => img.url.trim()).filter(Boolean),
        );
        const seen = rawRow.customerLastSeenCommercialProposalVersion ?? 0;
        const hasUnseenCommercialProposal = latest != null && latest.versionNumber > seen;
        return {
          ...this.mapListItemForUser(rawRow),
          hasPublishedCommercialProposal: latest != null,
          publishedCommercialProposalVersion: latest?.versionNumber ?? null,
          commercialProposalOffer,
          commercialProposalDeliveryEta,
          commercialProposalImageUrls,
          commercialProposalPublishedAt: latest?.publishedAt?.toISOString() ?? null,
          hasUnseenCommercialProposal,
          unreadStaffChatCount: unreadStaffById[r.id] ?? 0,
        };
      }),
      total,
      page: pageNum,
      limit: take,
    };
  }

  async findOneDetailForUser(userId: string, id: string) {
    const row = await this.prisma.sourcingRequest.findFirst({
      where: { id, userId },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { referenceImages: { orderBy: { sortOrder: 'asc' } } },
        },
        attachments: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!row) return null;
    const unreadMap = await this.orderChat.unreadStaffCountsForCustomerSourcingRequests(userId, [row.id]);
    return { ...this.mapDetailForUser(row), unreadStaffChatCount: unreadMap[row.id] ?? 0 };
  }

  /** Клиент открыл заявку — фиксируем просмотр последнего опубликованного КП. */
  async ackCommercialProposalSeenForCustomer(userId: string, requestId: string) {
    const row = await this.prisma.sourcingRequest.findFirst({
      where: { id: requestId, userId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException();
    const latest = await this.prisma.sourcingCommercialProposal.findFirst({
      where: { sourcingRequestId: requestId, status: CommercialProposalStatus.PUBLISHED },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const v = latest?.versionNumber ?? 0;
    await this.prisma.sourcingRequest.update({
      where: { id: requestId },
      data: { customerLastSeenCommercialProposalVersion: v },
    });
    return { ok: true as const, customerLastSeenCommercialProposalVersion: v };
  }

  async countPendingReviewForAdmin(): Promise<{ total: number }> {
    const total = await this.prisma.sourcingRequest.count({
      where: { status: SourcingRequestStatus.PENDING_REVIEW },
    });
    return { total };
  }

  /** Дашборд: новые + в работе; опционально фильтр по createdAt. */
  async getDashboardStatusSummaryForAdmin(opts?: {
    from?: string;
    to?: string;
  }): Promise<{ pendingReview: number; inProgress: number }> {
    const createdAt = createdAtInRange(parseDashboardDateRange(opts?.from, opts?.to));
    const [pendingReview, inProgress] = await Promise.all([
      this.prisma.sourcingRequest.count({
        where: {
          status: SourcingRequestStatus.PENDING_REVIEW,
          ...(createdAt ? { createdAt } : {}),
        },
      }),
      this.prisma.sourcingRequest.count({
        where: {
          status: SourcingRequestStatus.IN_PROGRESS,
          ...(createdAt ? { createdAt } : {}),
        },
      }),
    ]);
    return { pendingReview, inProgress };
  }

  async findManyForAdmin(
    page: number,
    limit: number,
    q?: string,
    userId?: string,
    bucket?: string,
    staffUserId?: string,
  ) {
    const pageNum = clampSourcingListPage(page);
    const take = clampSourcingListLimit(limit);
    const statuses = adminBucketStatuses(bucket);
    const where: Prisma.SourcingRequestWhereInput = {
      ...(userId ? { userId } : {}),
      ...(statuses ? { status: { in: [...statuses] as SourcingRequestStatus[] } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { deliveryCity: { contains: q, mode: 'insensitive' } },
              { id: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
              { user: { phone: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.sourcingRequest.count({ where }),
      this.prisma.sourcingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * take,
        take,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
          items: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } },
        },
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const unreadByRequest =
      staffUserId?.trim() && ids.length
        ? await this.orderChat.unreadCustomerCountsForStaffSourcingRequests(staffUserId.trim(), ids)
        : null;
    const chatExists = ids.length
      ? new Set(
          (
            await this.prisma.chatConversation.findMany({
              where: { sourcingRequestId: { in: ids } },
              select: { sourcingRequestId: true },
            })
          )
            .map((c) => c.sourcingRequestId)
            .filter((id): id is string => Boolean(id)),
        )
      : new Set<string>();

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        deliveryCity: r.deliveryCity,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        user: r.user,
        items: r.items,
        hasChatMessages: chatExists.has(r.id),
        unreadCustomerChatCount: unreadByRequest ? (unreadByRequest[r.id] ?? 0) : 0,
      })),
      total,
      page: pageNum,
      limit: take,
    };
  }

  async findOneForAdmin(id: string) {
    const row = await this.prisma.sourcingRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { referenceImages: { orderBy: { sortOrder: 'asc' } } },
        },
        attachments: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      deliveryCity: row.deliveryCity,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      user: row.user,
      items: row.items.map((item) => ({
        id: item.id,
        name: item.name,
        productLink: item.productLink,
        material: item.material,
        color: item.color,
        size: item.size,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        expectedBudget: item.expectedBudget?.toString() ?? null,
        referenceImages: item.referenceImages.map((img) => ({
          id: img.id,
          url: img.url,
          filename: img.filename,
          mimeType: img.mimeType,
        })),
      })),
      attachments: row.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        filename: a.filename,
        mimeType: a.mimeType,
      })),
    };
  }

  /**
   * Смена статуса заявки (админ). PATCH с тем же status → 200 без audit и без side-effects
   * (идемпотентность для повторных запросов UI).
   */
  async updateStatus(id: string, status: SourcingRequestStatus, staffUserId: string) {
    const prev = await this.prisma.sourcingRequest.findUnique({
      where: { id },
      select: { id: true, status: true, updatedAt: true },
    });
    if (!prev) throw new NotFoundException();

    assertSourcingStatusTransition(prev.status, status);
    if (prev.status === status) {
      return {
        id: prev.id,
        status: prev.status,
        updatedAt: prev.updatedAt.toISOString(),
      };
    }

    let row: { id: string; status: SourcingRequestStatus; updatedAt: Date };
    try {
      row = await this.prisma.sourcingRequest.update({
        where: { id },
        data: { status },
        select: { id: true, status: true, updatedAt: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException();
      }
      throw e;
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'SourcingRequest',
      entityId: id,
      path: `/api/v1/sourcing-requests/admin/${id}/status`,
      httpMethod: 'PATCH',
      actorUserId: staffUserId,
      metadata: {
        from: prev.status,
        to: status,
        staffUserId,
      },
    });

    await this.orderChat.onSourcingStatusChanged(row.id, row.status);
    return {
      id: row.id,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapListItemForUser(
    row: Prisma.SourcingRequestGetPayload<{
      include: {
        items: {
          include: { referenceImages: true };
        };
      };
    }>,
  ) {
    return {
      id: row.id,
      title: row.title,
      deliveryCity: row.deliveryCity,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: row.items.map((item) => {
        const referenceImageUrls = item.referenceImages
          .map((img) => img.url.trim())
          .filter(Boolean);
        return {
          id: item.id,
          name: item.name,
          referenceImageUrl: referenceImageUrls[0] ?? null,
          referenceImageUrls,
        };
      }),
    };
  }

  private mapDetailForUser(
    row: Prisma.SourcingRequestGetPayload<{
      include: {
        items: { include: { referenceImages: true } };
        attachments: true;
      };
    }>,
  ) {
    return {
      id: row.id,
      title: row.title,
      deliveryCity: row.deliveryCity,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: row.items.map((item) => ({
        id: item.id,
        name: item.name,
        productLink: item.productLink,
        material: item.material,
        color: item.color,
        size: item.size,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        expectedBudget: item.expectedBudget?.toString() ?? null,
        referenceImages: item.referenceImages.map((img) => ({
          id: img.id,
          url: img.url,
          filename: img.filename,
          mimeType: img.mimeType,
        })),
      })),
      attachments: row.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        filename: a.filename,
        mimeType: a.mimeType,
      })),
    };
  }

  private async notifyStaffSourcingSubmitted(requestId: string): Promise<void> {
    const recipients = await this.orderChat.getStaffNotifyEmailRecipients();
    if (!recipients.length) {
      this.logger.log(
        'Sourcing submit: no staff email recipients (set ORDER_CHAT_STAFF_EMAIL or add admin/moderator emails)',
      );
      return;
    }
    const row = await this.prisma.sourcingRequest.findUnique({
      where: { id: requestId },
      select: { id: true, title: true },
    });
    if (!row) return;
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    const shortId =
      requestId.length >= 8 ? `${requestId.slice(0, 4)}…${requestId.slice(-4)}` : requestId;
    await this.mail.sendSourcingSubmittedStaff({
      recipients,
      requestDisplayId: shortId,
      requestTitle: row.title,
      adminSourcingUrl: `${frontBase}/admin/orders/sourcing/${encodeURIComponent(requestId)}`,
    });
  }

  /** Удаление заявки на рассмотрении (до начала работы). */
  async deletePendingReviewForAdmin(requestId: string): Promise<void> {
    const row = await this.prisma.sourcingRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        attachments: { select: { url: true } },
        items: { select: { referenceImages: { select: { url: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Заявка не найдена');
    if (row.status !== SourcingRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException('Удалять можно только новую заявку на рассмотрении');
    }

    await this.orderChat.purgeSourcingChatMediaForRequest(requestId);

    const objectKeys: string[] = [];
    for (const a of row.attachments) {
      const key = this.storage.tryPublicUrlToKey(a.url);
      if (key) objectKeys.push(key);
    }
    for (const item of row.items) {
      for (const img of item.referenceImages) {
        const key = this.storage.tryPublicUrlToKey(img.url);
        if (key) objectKeys.push(key);
      }
    }

    await this.prisma.sourcingRequest.delete({ where: { id: requestId } });
    await this.cleanupUploadedObjectKeys(objectKeys);

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: 'SourcingRequest',
      entityId: requestId,
      path: `/api/v1/sourcing-requests/admin/${requestId}`,
      httpMethod: 'DELETE',
      metadata: { fromStatus: SourcingRequestStatus.PENDING_REVIEW },
    });
  }
}
