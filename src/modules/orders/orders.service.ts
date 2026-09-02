import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, CommercialProposalStatus, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { orderItemSnapshotMetaRows } from '@win-win/order-item-snapshot';
import { PrismaService } from '../../prisma/prisma.service';
import { priceToNumber } from '../../meilisearch/product-search-doc';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../auth/mail.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import { ReferralsService } from '../referrals/referrals.service';
import { OrderProgramSnapshotService } from '../user-groups/order-program-snapshot.service';
import { CatalogTierPricingService } from '../catalog/catalog-tier-pricing.service';
import type {
  AddOrderPreparationLineDto,
  PatchOrderPreparationDto,
  PatchOrderPreparationLineDto,
  SubmitPreparationDraftDto,
} from './dto/order-preparation.dto';
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COMPLETED_STATUSES,
  CUSTOMER_IN_WORK_STATUSES,
} from './order-status.constants';
import {
  createdAtInRange,
  parseDashboardDateRange,
} from '../../common/utils/dashboard-date-range';

const USER_ORDER_LIST_WHERE: Prisma.OrderWhereInput = {
  status: { not: OrderStatus.DRAFT },
};

type CpLineForOfferAgg = {
  quantity: number;
  offerUnitPrice: unknown;
  discountPercent: unknown | null;
};

/** Итоги последнего опубликованного КП для карточки списка заказов в ЛК. */
function commercialProposalOfferFromLines(
  lines: CpLineForOfferAgg[] | null | undefined,
): { oldTotalRub: number; newTotalRub: number; avgDiscountPercent: number } | null {
  if (!lines?.length) return null;
  let oldTotal = 0;
  let newTotal = 0;
  let weightedDisc = 0;
  for (const l of lines) {
    const unit = priceToNumber(l.offerUnitPrice);
    const qty = l.quantity;
    const base = unit * qty;
    oldTotal += base;
    const discRaw = l.discountPercent;
    const disc =
      discRaw != null && discRaw !== ''
        ? typeof discRaw === 'number'
          ? discRaw
          : parseFloat(String(discRaw))
        : 0;
    const d = Number.isFinite(disc) ? disc : 0;
    const factor = 1 - Math.min(100, Math.max(0, d)) / 100;
    newTotal += Math.round(unit * factor * qty * 100) / 100;
    weightedDisc += base * d;
  }
  oldTotal = Math.round(oldTotal * 100) / 100;
  newTotal = Math.round(newTotal * 100) / 100;
  return {
    oldTotalRub: oldTotal,
    newTotalRub: newTotal,
    avgDiscountPercent: oldTotal > 0 ? weightedDisc / oldTotal : 0,
  };
}

export type AdminOrdersListBucket = 'new' | 'active' | 'completed';

function adminListBucketWhere(bucketRaw?: string): Prisma.OrderWhereInput {
  const b = (bucketRaw?.trim() || 'new').toLowerCase();
  if (b === 'completed') return { status: { in: [...ADMIN_COMPLETED_STATUSES] } };
  if (b === 'active') return { status: { in: [...ADMIN_ACTIVE_STATUSES] } };
  return { status: OrderStatus.PENDING_APPROVAL };
}

/** ЛК: `work` — не завершённые; `completed` — только «Завершен». */
function userOrdersScopeWhere(scopeRaw?: string): Prisma.OrderWhereInput | undefined {
  const s = (scopeRaw || '').trim().toLowerCase();
  if (s === 'work' || s === 'in_work') return { status: { in: [...CUSTOMER_IN_WORK_STATUSES] } };
  if (s === 'completed') return { status: OrderStatus.COMPLETED };
  return undefined;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private readonly mail: MailService,
    private readonly orderChat: OrderChatService,
    private readonly config: ConfigService,
    private readonly referrals: ReferralsService,
    private readonly orderProgramSnapshots: OrderProgramSnapshotService,
    private readonly tierPricing: CatalogTierPricingService,
  ) {}

  async findByUser(userId: string, page = 1, limit = 20, scopeRaw?: string) {
    const scopeWhere = userOrdersScopeWhere(scopeRaw);
    const where: Prisma.OrderWhereInput = {
      AND: [{ userId }, USER_ORDER_LIST_WHERE, ...(scopeWhere ? [scopeWhere] : [])],
    };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              product: {
                include: {
                  images: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
                },
              },
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
              select: { quantity: true, offerUnitPrice: true, discountPercent: true, deliveryEta: true },
            },
          },
        },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    const unreadStaffByOrderId = await this.orderChat.unreadStaffCountsForCustomerOrders(
      userId,
      orders.map((o) => o.id),
    );
    return {
      items: orders.map((o) => {
        const { commercialProposals, customerLastSeenCommercialProposalVersion, ...rest } = o;
        const latest = commercialProposals[0];
        const commercialProposalOffer = latest?.lines?.length
          ? commercialProposalOfferFromLines(latest.lines)
          : null;
        const deliveryEtas = (latest?.lines ?? [])
          .map((l) => (typeof l.deliveryEta === 'string' ? l.deliveryEta.trim() : ''))
          .filter(Boolean);
        const commercialProposalDeliveryEta = deliveryEtas.length ? deliveryEtas.join(' · ') : null;
        const seen = customerLastSeenCommercialProposalVersion ?? 0;
        const hasUnseenCommercialProposal = latest != null && latest.versionNumber > seen;
        return {
          ...rest,
          commercialProposalOffer,
          commercialProposalDeliveryEta,
          commercialProposalPublishedAt: latest?.publishedAt?.toISOString() ?? null,
          hasUnseenCommercialProposal,
          unreadStaffChatCount: unreadStaffByOrderId[o.id] ?? 0,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async findOne(userId: string, orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { product: { include: { images: true, brand: true } } },
        },
      },
    });
  }

  /** Детали заказа для ЛК: как `findOne`, плюс счётчик непрочитанных сообщений от сотрудника в чате. */
  async findOneDetailForUser(userId: string, orderId: string) {
    const order = await this.findOne(userId, orderId);
    if (!order) return null;
    const unreadMap = await this.orderChat.unreadStaffCountsForCustomerOrders(userId, [order.id]);
    return { ...order, unreadStaffChatCount: unreadMap[order.id] ?? 0 };
  }

  /** Клиент открыл карточку заказа — фиксируем просмотр последнего опубликованного КП (сброс «новой версии» в ЛК). */
  async ackCommercialProposalSeenForCustomer(userId: string, orderId: string) {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException();
    const latest = await this.prisma.commercialProposal.findFirst({
      where: { orderId, status: CommercialProposalStatus.PUBLISHED },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const v = latest?.versionNumber ?? 0;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { customerLastSeenCommercialProposalVersion: v },
    });
    return { ok: true as const, customerLastSeenCommercialProposalVersion: v };
  }

  async findManyForAdmin(
    page = 1,
    limit = 20,
    q?: string,
    userIdFilter?: string,
    bucketRaw?: string,
    staffUserId?: string,
    opts?: { from?: string; to?: string },
  ) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const search: Prisma.OrderWhereInput | undefined = q
      ? {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : undefined;
    const uid = userIdFilter?.trim();
    const userClause: Prisma.OrderWhereInput | undefined = uid ? { userId: uid } : undefined;
    const createdAt = createdAtInRange(parseDashboardDateRange(opts?.from, opts?.to));
    const clauses: Prisma.OrderWhereInput[] = [USER_ORDER_LIST_WHERE, adminListBucketWhere(bucketRaw)];
    if (userClause) clauses.push(userClause);
    if (search) clauses.push(search);
    if (createdAt) clauses.push({ createdAt });
    const where: Prisma.OrderWhereInput = { AND: clauses };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
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
          items: { include: { product: { select: { id: true, name: true, slug: true } } } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    const unreadByOrder =
      staffUserId?.trim() && rows.length
        ? await this.orderChat.unreadCustomerCountsForStaffOrders(
            staffUserId.trim(),
            rows.map((r) => r.id),
          )
        : null;
    const orderIds = rows.map((r) => r.id);
    const chatExists = orderIds.length
      ? new Set(
          (
            await this.prisma.chatConversation.findMany({
              where: { orderId: { in: orderIds } },
              select: { orderId: true },
            })
          )
            .map((c) => c.orderId)
            .filter((id): id is string => Boolean(id)),
        )
      : new Set<string>();
    const items = rows.map((o) => ({
      ...o,
      hasChatMessages: chatExists.has(o.id),
      unreadCustomerChatCount: unreadByOrder ? (unreadByOrder[o.id] ?? 0) : 0,
    }));
    return { items, total, page: Math.max(page, 1), limit: take };
  }

  async countPendingApprovalForAdmin(): Promise<{ total: number }> {
    const total = await this.prisma.order.count({
      where: { status: OrderStatus.PENDING_APPROVAL },
    });
    return { total };
  }

  /** Дашборд: новые (на согласовании) + в работе; опционально фильтр по createdAt. */
  async getDashboardStatusSummaryForAdmin(opts?: {
    from?: string;
    to?: string;
  }): Promise<{ new: number; active: number }> {
    const createdAt = createdAtInRange(parseDashboardDateRange(opts?.from, opts?.to));
    const [newCount, active] = await Promise.all([
      this.prisma.order.count({
        where: {
          status: OrderStatus.PENDING_APPROVAL,
          ...(createdAt ? { createdAt } : {}),
        },
      }),
      this.prisma.order.count({
        where: {
          status: { in: [...ADMIN_ACTIVE_STATUSES] },
          ...(createdAt ? { createdAt } : {}),
        },
      }),
    ]);
    return { new: newCount, active };
  }

  async findOneForAdmin(orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId },
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
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { product: { include: { images: true, brand: true } } },
        },
      },
    });
  }

  /**
   * Смена статуса заказа (админ). PATCH с тем же status → 200 без audit и без side-effects
   * (идемпотентность для повторных запросов UI).
   */
  async updateStatus(orderId: string, status: OrderStatus, documentUrls?: Record<string, string>) {
    const prev = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!prev) throw new NotFoundException('Order not found');
    if (prev.status === OrderStatus.DRAFT) {
      throw new BadRequestException('Черновик заказа редактируется только в личном кабинете клиента');
    }
    if (status === OrderStatus.DRAFT) {
      throw new BadRequestException('Нельзя перевести заказ в статус «Черновик»');
    }
    if (prev.status === status) {
      const existing = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });
      if (!existing) throw new NotFoundException('Order not found');
      return existing;
    }
    const order = await this.prisma.order.update({
      where: { id: orderId },
      data: { status, documentUrls: documentUrls ?? undefined },
      include: { items: { include: { product: true } } },
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'Order',
      entityId: orderId,
      path: `/api/v1/orders/admin/${orderId}/status`,
      httpMethod: 'PATCH',
      metadata: {
        from: prev.status,
        to: status,
        hasDocumentUrls: !!documentUrls && Object.keys(documentUrls).length > 0,
      },
    });
    if (status === OrderStatus.COMPLETED) {
      try {
        await this.referrals.ensureRewardsForCompletedOrder(orderId);
      } catch (e) {
        this.logger.error(
          `Referral rewards sync failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    await this.orderChat.onOrderStatusChanged(order.id, order.status);
    return order;
  }

  /** Удаление заказа на согласовании (отмена заявки до начала работы). */
  async deletePendingApprovalOrderForAdmin(orderId: string) {
    const prev = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!prev) throw new NotFoundException('Order not found');
    if (prev.status !== OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Удалять можно только заказ на согласовании');
    }
    await this.orderChat.purgeOrderChatMediaForOrder(orderId);
    await this.prisma.order.delete({ where: { id: orderId } });
    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: 'Order',
      entityId: orderId,
      path: `/api/v1/orders/admin/${orderId}`,
      httpMethod: 'DELETE',
      metadata: { fromStatus: OrderStatus.PENDING_APPROVAL },
    });
  }

  // --- Подготовка заказа (черновик в ЛК) ---

  private draftInclude() {
    return {
      items: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] as const,
        include: {
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              images: { take: 1, orderBy: { sortOrder: 'asc' as const }, select: { url: true } },
            },
          },
          productVariant: { select: { id: true, price: true, productId: true } },
        },
      },
    } satisfies Prisma.OrderInclude;
  }

  private async findOrCreateDraftOrder(userId: string) {
    const existing = await this.prisma.order.findFirst({
      where: { userId, status: OrderStatus.DRAFT },
      orderBy: { updatedAt: 'desc' },
      include: this.draftInclude(),
    });
    if (existing) return existing;
    try {
      return await this.prisma.order.create({
        data: {
          userId,
          status: OrderStatus.DRAFT,
          totalAmount: new Prisma.Decimal(0),
          currency: 'RUB',
        },
        include: this.draftInclude(),
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.order.findFirst({
          where: { userId, status: OrderStatus.DRAFT },
          orderBy: { updatedAt: 'desc' },
          include: this.draftInclude(),
        });
        if (again) return again;
      }
      throw e;
    }
  }

  private async validateProductLine(productId: string, productVariantId: string | null | undefined) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Товар не найден или отключён');
    const vid = productVariantId?.trim();
    if (vid) {
      const v = await this.prisma.productVariant.findFirst({
        where: { id: vid, isActive: true, productId },
        select: { id: true },
      });
      if (!v) throw new BadRequestException('Несогласованный вариант SKU для товара');
    }
  }

  private resolveUnitPriceRub(
    userId: string,
    productId: string,
    productVariantId: string | null,
    snapshot: Record<string, unknown> | null,
  ): Promise<number> {
    return this.tierPricing.resolveOrderLineUnitPriceRub(
      userId,
      productId,
      productVariantId,
      snapshot,
    );
  }

  private formatPriceLabel(unitRub: number, snapshot: Record<string, unknown> | null): string {
    if (unitRub > 0) {
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(unitRub) + ' ₽';
    }
    const min = snapshot?.catalogPriceMinRub;
    const max = snapshot?.catalogPriceMaxRub;
    if (
      typeof min === 'number' &&
      typeof max === 'number' &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min > 0 &&
      max >= min
    ) {
      const a = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(min);
      const b = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(max);
      return min === max ? `~ ${a} ₽` : `~ ${a} – ${b} ₽`;
    }
    return '—';
  }

  private async recalcDraftTotal(
    orderId: string,
    db: Pick<PrismaService, 'orderItem' | 'order'> = this.prisma,
  ) {
    const items = await db.orderItem.findMany({
      where: { orderId },
      select: { price: true, quantity: true },
    });
    let sum = 0;
    for (const it of items) {
      sum += Number(it.price) * it.quantity;
    }
    await db.order.update({
      where: { id: orderId },
      data: { totalAmount: new Prisma.Decimal(sum.toFixed(2)) },
    });
  }

  async getPreparationDraft(userId: string) {
    const order = await this.findOrCreateDraftOrder(userId);
    return this.formatPreparationResponse(order);
  }

  private formatPreparationResponse(
    order: Prisma.OrderGetPayload<{ include: ReturnType<OrdersService['draftInclude']> }>,
  ) {
    const snap = (row: { snapshot: unknown }) => (row.snapshot && typeof row.snapshot === 'object' ? row.snapshot as Record<string, unknown> : null);
    const lines = order.items.map((it) => {
      const s = snap(it);
      const name =
        (s?.productName && typeof s.productName === 'string' && s.productName.trim()) ||
        it.product.name.trim() ||
        'Товар';
      const unitRub = Number(it.price);
      const price = this.formatPriceLabel(unitRub, s);
      const lineTotalRub = unitRub > 0 ? unitRub * it.quantity : null;
      const imageUrl =
        (s?.imageUrl && typeof s.imageUrl === 'string' && s.imageUrl.trim()) || it.product.images[0]?.url || null;
      return {
        id: it.id,
        productId: it.productId,
        productSlug: it.product.slug,
        name,
        price,
        metaRows: orderItemSnapshotMetaRows(s),
        quantity: it.quantity,
        unit: it.unit || 'шт',
        productVariantId: it.productVariantId,
        imageUrl,
        priceRubPerUnit: unitRub > 0 ? unitRub : null,
        lineTotalRub,
      };
    });
    return {
      orderId: order.id,
      customerName: order.customerName ?? '',
      deliveryAddress: order.deliveryAddress ?? '',
      comment: order.comment ?? '',
      totalRub: Number(order.totalAmount),
      lines,
    };
  }

  async patchPreparationDraft(userId: string, dto: PatchOrderPreparationDto) {
    const order = await this.findOrCreateDraftOrder(userId);
    if (order.userId !== userId) throw new NotFoundException();
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        customerName: dto.customerName !== undefined ? dto.customerName?.trim() || null : undefined,
        deliveryAddress: dto.deliveryAddress !== undefined ? dto.deliveryAddress?.trim() || null : undefined,
        comment: dto.comment !== undefined ? dto.comment?.trim() || null : undefined,
      },
    });
    return this.getPreparationDraft(userId);
  }

  async addPreparationLine(userId: string, dto: AddOrderPreparationLineDto) {
    const qty = dto.quantity != null && Number.isFinite(dto.quantity) ? Math.floor(dto.quantity) : 1;
    if (qty < 1) throw new BadRequestException('Некорректное количество');
    await this.validateProductLine(dto.productId, dto.productVariantId);
    const snapshot = (dto.snapshot ?? {}) as Record<string, unknown>;
    const variantId = dto.productVariantId?.trim() || null;
    const unitRub = await this.resolveUnitPriceRub(userId, dto.productId, variantId, snapshot);
    const order = await this.findOrCreateDraftOrder(userId);
    const maxSort = await this.prisma.orderItem.aggregate({
      where: { orderId: order.id },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    await this.prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: dto.productId,
        productVariantId: variantId,
        quantity: qty,
        unit: (dto.unit?.trim() || 'шт').slice(0, 32),
        sortOrder,
        snapshot: snapshot as Prisma.InputJsonValue,
        price: new Prisma.Decimal(unitRub.toFixed(2)),
      },
    });
    await this.recalcDraftTotal(order.id);
    return this.getPreparationDraft(userId);
  }

  async patchPreparationLine(userId: string, lineId: string, dto: PatchOrderPreparationLineDto) {
    const line = await this.prisma.orderItem.findFirst({
      where: { id: lineId },
      include: { order: true },
    });
    if (!line || line.order.userId !== userId || line.order.status !== OrderStatus.DRAFT) {
      throw new NotFoundException();
    }
    await this.prisma.orderItem.update({
      where: { id: lineId },
      data: { quantity: dto.quantity },
    });
    await this.recalcDraftTotal(line.orderId);
    return this.getPreparationDraft(userId);
  }

  async removePreparationLine(userId: string, lineId: string) {
    const line = await this.prisma.orderItem.findFirst({
      where: { id: lineId },
      include: { order: true },
    });
    if (!line || line.order.userId !== userId || line.order.status !== OrderStatus.DRAFT) {
      throw new NotFoundException();
    }
    await this.prisma.orderItem.delete({ where: { id: lineId } });
    await this.recalcDraftTotal(line.orderId);
    return this.getPreparationDraft(userId);
  }

  async submitPreparationDraft(userId: string, dto?: SubmitPreparationDraftDto) {
    if (dto?.lineIds !== undefined && dto.lineIds.length === 0) {
      throw new BadRequestException('Передайте id выбранных позиций или не указывайте lineIds');
    }
    const lineIdsFilter =
      dto?.lineIds != null && dto.lineIds.length > 0 ? [...new Set(dto.lineIds.map((id) => id.trim()).filter(Boolean))] : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { userId, status: OrderStatus.DRAFT },
        orderBy: { updatedAt: 'desc' },
        include: { items: true },
      });
      if (!order) throw new NotFoundException();
      if (order.items.length === 0) {
        throw new BadRequestException('Добавьте хотя бы один товар в заказ');
      }

      if (lineIdsFilter) {
        const allowed = new Set(order.items.map((i) => i.id));
        for (const id of lineIdsFilter) {
          if (!allowed.has(id)) {
            throw new BadRequestException('Указана позиция, которой нет в текущем заказе');
          }
        }
        const removeIds = order.items.filter((i) => !lineIdsFilter.includes(i.id)).map((i) => i.id);
        if (removeIds.length) {
          await tx.orderItem.deleteMany({ where: { id: { in: removeIds } } });
        }
      }

      const orderAfter = await tx.order.findFirst({
        where: { id: order.id },
        include: { items: true },
      });
      if (!orderAfter || orderAfter.items.length === 0) {
        throw new BadRequestException('Добавьте хотя бы один товар в заказ');
      }

      const name = orderAfter.customerName?.trim();
      const addr = orderAfter.deliveryAddress?.trim();
      if (!name) throw new BadRequestException('Укажите ФИО заказчика');
      if (!addr) throw new BadRequestException('Укажите адрес доставки');

      await this.recalcDraftTotal(orderAfter.id, tx);

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PENDING_APPROVAL },
        include: this.draftInclude(),
      });
      return { updated, itemCount: orderAfter.items.length };
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'Order',
      entityId: result.updated.id,
      path: '/api/v1/orders/me/preparation/submit',
      httpMethod: 'POST',
      metadata: {
        to: OrderStatus.PENDING_APPROVAL,
        itemCount: result.itemCount,
        partialSubmit: Boolean(lineIdsFilter),
      },
    });
    try {
      await this.orderProgramSnapshots.captureForOrderIfNeeded(result.updated.id, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Order submit: program snapshot failed: ${msg}`);
    }
    void this.notifyStaffOrderSubmitted(result.updated.id).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Order submit: staff email notify failed: ${msg}`);
    });

    const comment = result.updated.comment?.trim();
    if (comment) {
      try {
        await this.orderChat.postMessage(result.updated.id, userId, UserRole.USER, {
          body: comment,
          attachments: [],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Order submit: chat comment failed: ${msg}`);
      }
    }

    return this.formatPreparationResponse(result.updated);
  }

  private async notifyStaffOrderSubmitted(orderId: string): Promise<void> {
    const recipients = await this.orderChat.getStaffNotifyEmailRecipients();
    if (!recipients.length) {
      this.logger.log(
        'Order submit: no staff email recipients (set ORDER_CHAT_STAFF_EMAIL or add admin/moderator emails)',
      );
      return;
    }
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    const shortId =
      orderId.length >= 8 ? `${orderId.slice(0, 4)}…${orderId.slice(-4)}` : orderId;
    await this.mail.sendOrderSubmittedPendingApprovalStaff({
      recipients,
      orderDisplayId: shortId,
      orderId,
      adminOrderUrl: `${frontBase}/admin/orders/${encodeURIComponent(orderId)}`,
    });
  }
}
