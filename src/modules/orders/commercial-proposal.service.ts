import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommercialProposalStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import type { CommercialProposalLineInputDto, PublishCommercialProposalDto } from './dto/commercial-proposal.dto';
import { OrdersService } from './orders.service';

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? n.toFixed(2) : '0');
}

function numFromDecimal(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

@Injectable()
export class CommercialProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly orderChat: OrderChatService,
  ) {}

  private async assertOrderForKp(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });
    if (!o) throw new NotFoundException('Заказ не найден');
    if (o.status === OrderStatus.DRAFT) {
      throw new BadRequestException('КП недоступно для черновика заказа');
    }
    return o;
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

  private serializeLine(row: {
    id: string;
    sourceOrderItemId: string | null;
    sortOrder: number;
    productId: string;
    productVariantId: string | null;
    quantity: number;
    unit: string;
    snapshot: Prisma.JsonValue | null;
    offerUnitPrice: Prisma.Decimal;
    discountPercent: Prisma.Decimal | null;
    deliveryEta: string | null;
    lineNote: string | null;
  }) {
    return {
      id: row.id,
      sourceOrderItemId: row.sourceOrderItemId,
      sortOrder: row.sortOrder,
      productId: row.productId,
      productVariantId: row.productVariantId,
      quantity: row.quantity,
      unit: row.unit,
      snapshot: row.snapshot,
      offerUnitPrice: numFromDecimal(row.offerUnitPrice),
      discountPercent:
        row.discountPercent != null ? numFromDecimal(row.discountPercent) : null,
      deliveryEta: row.deliveryEta,
      lineNote: row.lineNote,
    };
  }

  private serializeProposal(p: {
    id: string;
    orderId: string;
    versionNumber: number;
    status: CommercialProposalStatus;
    publishedAt: Date | null;
    publishedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<Parameters<CommercialProposalService['serializeLine']>[0]>;
  }) {
    return {
      id: p.id,
      orderId: p.orderId,
      versionNumber: p.versionNumber,
      status: p.status,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      publishedByUserId: p.publishedByUserId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      lines: p.lines.map((l) => this.serializeLine(l)),
    };
  }

  async getSummary(orderId: string) {
    await this.assertOrderForKp(orderId);
    const [draft, published] = await Promise.all([
      this.prisma.commercialProposal.findFirst({
        where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
        select: {
          id: true,
          updatedAt: true,
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.commercialProposal.findMany({
        where: { orderId, status: CommercialProposalStatus.PUBLISHED },
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          publishedAt: true,
          _count: { select: { lines: true } },
        },
      }),
    ]);
    return {
      draft: draft
        ? {
            id: draft.id,
            lineCount: draft._count.lines,
            updatedAt: draft.updatedAt.toISOString(),
          }
        : null,
      published: published.map((p) => ({
        id: p.id,
        versionNumber: p.versionNumber,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        lineCount: p._count.lines,
      })),
    };
  }

  async getDraft(orderId: string) {
    await this.assertOrderForKp(orderId);
    const draft = await this.prisma.commercialProposal.findFirst({
      where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
      include: {
        lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!draft) throw new NotFoundException('Черновик КП не найден');
    return this.serializeProposal(draft);
  }

  async getPublished(orderId: string, versionNumber: number) {
    await this.assertOrderForKp(orderId);
    if (versionNumber < 1) throw new BadRequestException('Некорректная версия');
    const p = await this.prisma.commercialProposal.findFirst({
      where: {
        orderId,
        versionNumber,
        status: CommercialProposalStatus.PUBLISHED,
      },
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (!p) throw new NotFoundException('Версия КП не найдена');
    return this.serializeProposal(p);
  }

  private async deleteDraftTx(tx: Prisma.TransactionClient, orderId: string) {
    await tx.commercialProposal.deleteMany({
      where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
    });
  }

  private async createDraftWithLines(
    orderId: string,
    lines: {
      sourceOrderItemId: string | null;
      sortOrder: number;
      productId: string;
      productVariantId: string | null;
      quantity: number;
      unit: string;
      snapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      offerUnitPrice: Prisma.Decimal;
      discountPercent: Prisma.Decimal | null;
      deliveryEta: string | null;
      lineNote: string | null;
    }[],
  ) {
    return this.prisma.commercialProposal.create({
      data: {
        orderId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
        lines: {
          create: lines.map((l) => ({
            sourceOrderItemId: l.sourceOrderItemId,
            sortOrder: l.sortOrder,
            productId: l.productId,
            productVariantId: l.productVariantId,
            quantity: l.quantity,
            unit: l.unit.slice(0, 32),
            snapshot: l.snapshot,
            offerUnitPrice: l.offerUnitPrice,
            discountPercent: l.discountPercent,
            deliveryEta: l.deliveryEta,
            lineNote: l.lineNote,
          })),
        },
      },
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
  }

  private snapshotRecord(snapshot: Prisma.JsonValue | null): Record<string, unknown> {
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      return { ...(snapshot as Record<string, unknown>) };
    }
    return {};
  }

  private mergeVariantGrossIntoSnapshot(
    snapshot: Prisma.JsonValue | null,
    variant: {
      lengthMm: number | null;
      widthMm: number | null;
      heightMm: number | null;
      volumeLiters: Prisma.Decimal | null;
      weightKg: Prisma.Decimal | null;
    },
  ): Prisma.InputJsonValue {
    const out = this.snapshotRecord(snapshot);
    const num = (v: Prisma.Decimal | null) => (v != null ? Number(v) : null);
    const vol = num(variant.volumeLiters);
    const w = num(variant.weightKg);
    if (out.lengthMm == null && variant.lengthMm != null) out.lengthMm = variant.lengthMm;
    if (out.widthMm == null && variant.widthMm != null) out.widthMm = variant.widthMm;
    if (out.heightMm == null && variant.heightMm != null) out.heightMm = variant.heightMm;
    if (out.volumeLiters == null && vol != null && Number.isFinite(vol)) out.volumeLiters = vol;
    if (out.weightKg == null && w != null && Number.isFinite(w)) out.weightKg = w;
    return out as Prisma.InputJsonValue;
  }

  private async enrichLinesWithVariantGross<
    T extends { productVariantId: string | null; snapshot: Prisma.InputJsonValue | typeof Prisma.JsonNull },
  >(lines: T[]): Promise<T[]> {
    const variantIds = [
      ...new Set(
        lines.map((l) => l.productVariantId?.trim()).filter((id): id is string => Boolean(id)),
      ),
    ];
    if (variantIds.length === 0) return lines;
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
        volumeLiters: true,
        weightKg: true,
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return lines.map((line) => {
      const vid = line.productVariantId?.trim();
      if (!vid) return line;
      const v = byId.get(vid);
      if (!v) return line;
      return {
        ...line,
        snapshot: this.mergeVariantGrossIntoSnapshot(
          line.snapshot === Prisma.JsonNull ? null : (line.snapshot as Prisma.JsonValue),
          v,
        ),
      };
    });
  }

  /** Черновик из строк заказа (после удаления старого черновика, если был). */
  private buildLinesFromOrderItems(
    items: {
      id: string;
      productId: string;
      productVariantId: string | null;
      quantity: number;
      unit: string;
      snapshot: Prisma.JsonValue | null;
      price: Prisma.Decimal;
      sortOrder: number;
    }[],
  ) {
    return items.map((it, idx) => ({
      sourceOrderItemId: it.id,
      sortOrder: it.sortOrder ?? idx,
      productId: it.productId,
      productVariantId: it.productVariantId,
      quantity: it.quantity,
      unit: it.unit || 'шт',
      snapshot: (it.snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      offerUnitPrice: it.price,
      discountPercent: null as Prisma.Decimal | null,
      deliveryEta: null as string | null,
      lineNote: null as string | null,
    }));
  }

  async initDraft(orderId: string, fromPublishedProposalId?: string) {
    const order = await this.assertOrderForKp(orderId);

    if (fromPublishedProposalId?.trim()) {
      const pub = await this.prisma.commercialProposal.findFirst({
        where: {
          id: fromPublishedProposalId.trim(),
          orderId,
          status: CommercialProposalStatus.PUBLISHED,
        },
        include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      });
      if (!pub) throw new NotFoundException('Опубликованное КП не найдено');

      return this.prisma.$transaction(async (tx) => {
        await this.deleteDraftTx(tx, orderId);
        const lines = pub.lines.map((l) => ({
          sourceOrderItemId: l.sourceOrderItemId,
          sortOrder: l.sortOrder,
          productId: l.productId,
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unit: l.unit,
          snapshot: (l.snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          offerUnitPrice: l.offerUnitPrice,
          discountPercent: l.discountPercent,
          deliveryEta: l.deliveryEta,
          lineNote: l.lineNote,
        }));
        const created = await tx.commercialProposal.create({
          data: {
            orderId,
            versionNumber: 0,
            status: CommercialProposalStatus.DRAFT,
            lines: {
              create: lines.map((l) => ({
                sourceOrderItemId: l.sourceOrderItemId,
                sortOrder: l.sortOrder,
                productId: l.productId,
                productVariantId: l.productVariantId,
                quantity: l.quantity,
                unit: l.unit.slice(0, 32),
                snapshot: l.snapshot,
                offerUnitPrice: l.offerUnitPrice,
                discountPercent: l.discountPercent,
                deliveryEta: l.deliveryEta,
                lineNote: l.lineNote,
              })),
            },
          },
          include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        });
        return this.serializeProposal(created);
      });
    }

    const existing = await this.prisma.commercialProposal.findFirst({
      where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (existing) return this.serializeProposal(existing);

    if (order.items.length === 0) {
      throw new BadRequestException('В заказе нет позиций для КП');
    }

    const lineData = await this.enrichLinesWithVariantGross(this.buildLinesFromOrderItems(order.items));
    const created = await this.createDraftWithLines(orderId, lineData);
    return this.serializeProposal(created);
  }

  async putDraft(orderId: string, lines: CommercialProposalLineInputDto[]) {
    await this.assertOrderForKp(orderId);
    const draft = await this.prisma.commercialProposal.findFirst({
      where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
    });
    if (!draft) throw new NotFoundException('Сначала создайте черновик КП');

    for (const l of lines) {
      await this.validateProductLine(l.productId, l.productVariantId ?? null);
    }

    const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);

    await this.prisma.$transaction(async (tx) => {
      await tx.commercialProposalLine.deleteMany({ where: { proposalId: draft.id } });
      for (const l of sorted) {
        const disc =
          l.discountPercent != null && Number.isFinite(l.discountPercent)
            ? dec(Math.min(100, Math.max(0, l.discountPercent)))
            : null;
        await tx.commercialProposalLine.create({
          data: {
            proposalId: draft.id,
            sourceOrderItemId: l.sourceOrderItemId?.trim() || null,
            sortOrder: l.sortOrder,
            productId: l.productId.trim(),
            productVariantId: l.productVariantId?.trim() || null,
            quantity: Math.floor(l.quantity),
            unit: (l.unit?.trim() || 'шт').slice(0, 32),
            snapshot: (l.snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            offerUnitPrice: dec(l.offerUnitPrice),
            discountPercent: disc,
            deliveryEta: l.deliveryEta?.trim() || null,
            lineNote: l.lineNote?.trim() || null,
          },
        });
      }
    });

    const full = await this.prisma.commercialProposal.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    return this.serializeProposal(full);
  }

  async publish(
    orderId: string,
    staffUserId: string,
    staffRole: string,
    dto?: PublishCommercialProposalDto,
  ) {
    await this.assertOrderForKp(orderId);
    const draft = await this.prisma.commercialProposal.findFirst({
      where: { orderId, versionNumber: 0, status: CommercialProposalStatus.DRAFT },
      include: { lines: true },
    });
    if (!draft) throw new BadRequestException('Нет черновика КП');
    if (draft.lines.length === 0) throw new BadRequestException('Добавьте хотя бы одну позицию в КП');

    const maxRow = await this.prisma.commercialProposal.aggregate({
      where: { orderId, versionNumber: { gt: 0 } },
      _max: { versionNumber: true },
    });
    const nextVersion = (maxRow._max.versionNumber ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.commercialProposal.update({
        where: { id: draft.id },
        data: {
          versionNumber: nextVersion,
          status: CommercialProposalStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedByUserId: staffUserId,
        },
      });

      const lineCopies = await tx.commercialProposalLine.findMany({
        where: { proposalId: draft.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      await tx.commercialProposal.create({
        data: {
          orderId,
          versionNumber: 0,
          status: CommercialProposalStatus.DRAFT,
          lines: {
            create: lineCopies.map((l) => ({
              sourceOrderItemId: l.sourceOrderItemId,
              sortOrder: l.sortOrder,
              productId: l.productId,
              productVariantId: l.productVariantId,
              quantity: l.quantity,
              unit: l.unit,
              snapshot: (l.snapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              offerUnitPrice: l.offerUnitPrice,
              discountPercent: l.discountPercent,
              deliveryEta: l.deliveryEta,
              lineNote: l.lineNote,
            })),
          },
        },
      });
    });

    const cur = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (cur?.status === OrderStatus.PENDING_APPROVAL) {
      const next =
        (dto?.nextOrderStatus as OrderStatus | undefined) ?? OrderStatus.PROPOSAL_FORMED;
      const updated = await this.orders.updateStatus(orderId, next);
      await this.orderChat.onOrderStatusChanged(updated.id, updated.status);
    }

    const summary = await this.getSummary(orderId);
    return { versionNumber: nextVersion, summary };
  }

  /** Для клиента: последняя опубликованная версия с строками. */
  async getLatestPublishedForOrder(orderId: string) {
    const p = await this.prisma.commercialProposal.findFirst({
      where: { orderId, status: CommercialProposalStatus.PUBLISHED },
      orderBy: { versionNumber: 'desc' },
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (!p) return null;
    return this.serializeProposal(p);
  }

  /** Проверка владельца заказа для пользовательского API. */
  async getLatestPublishedForUserOrder(userId: string, orderId: string) {
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true },
    });
    if (!o) return null;
    if (o.status === OrderStatus.DRAFT) return null;
    return this.getLatestPublishedForOrder(orderId);
  }
}
