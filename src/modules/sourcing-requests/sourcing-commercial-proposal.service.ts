import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CommercialProposalStatus,
  Prisma,
  SourcingRequestStatus,
} from '@prisma/client';
import {
  parseExpectedBudgetRetailRub,
  resolveSourcingProductDisplayName,
  resolveSourcingTypicalDims,
  TYPICAL_SOURCING_VOLUME_M3,
  TYPICAL_SOURCING_WEIGHT_KG,
} from '@win-win/sourcing-request';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingAdminService } from '../catalog/pricing-admin.service';
import type { PricingProfileCalcInput } from '../catalog/pricing-calculation';
import {
  forwardRetailFromProfileCalc,
  reverseRetailToCnyFromProfileCalc,
} from '../catalog/sourcing-kp-pricing-calc';
import type {
  InitSourcingCommercialProposalDraftDto,
  SourcingCommercialProposalLineInputDto,
} from './dto/sourcing-commercial-proposal.dto';

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? n.toFixed(2) : '0');
}

function decCny(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) && n >= 0 ? n.toFixed(2) : '0');
}

function dec3(n: number | null | undefined): Prisma.Decimal | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return new Prisma.Decimal(n.toFixed(3));
}

function dec6(n: number | null | undefined): Prisma.Decimal | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return new Prisma.Decimal(n.toFixed(6));
}

function numFromDecimal(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

const KP_LINES_INCLUDE = {
  orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  include: { images: { orderBy: { sortOrder: 'asc' as const } } },
};

const REQUEST_FOR_KP_INIT_SELECT = {
  id: true,
  title: true,
  items: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      sortOrder: true,
      name: true,
      description: true,
      quantity: true,
      unit: true,
      expectedBudget: true,
    },
  },
} satisfies Prisma.SourcingRequestSelect;

type RequestForKpInit = Prisma.SourcingRequestGetPayload<{ select: typeof REQUEST_FOR_KP_INIT_SELECT }>;

function normalizeLineImageUrls(urls: string[] | undefined | null): string[] {
  if (!urls?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = raw?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function lineImageCreates(urls: string[] | undefined | null) {
  return normalizeLineImageUrls(urls).map((url, sortOrder) => ({ url, sortOrder }));
}

@Injectable()
export class SourcingCommercialProposalService {
  private readonly logger = new Logger(SourcingCommercialProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingAdmin: PricingAdminService,
  ) {}

  private async assertRequestForKp(sourcingRequestId: string) {
    const row = await this.prisma.sourcingRequest.findUnique({
      where: { id: sourcingRequestId },
      include: {
        items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new NotFoundException('Заявка не найдена');
    if (row.status === SourcingRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException('Сначала возьмите заявку в работу');
    }
    if (row.status === SourcingRequestStatus.COMPLETED || row.status === SourcingRequestStatus.CANCELLED) {
      throw new BadRequestException('КП недоступно для завершённой или отменённой заявки');
    }
    return row;
  }

  private serializeLine(row: {
    id: string;
    sourceSourcingRequestItemId: string | null;
    sortOrder: number;
    productName: string;
    description: string | null;
    quantity: number;
    unit: string;
    costPriceCny: Prisma.Decimal;
    grossWeightKg: Prisma.Decimal | null;
    volumeM3: Prisma.Decimal | null;
    offerUnitPrice: Prisma.Decimal;
    deliveryEta: string | null;
    images?: Array<{ url: string; sortOrder: number }>;
  }) {
    return {
      id: row.id,
      sourceSourcingRequestItemId: row.sourceSourcingRequestItemId,
      sortOrder: row.sortOrder,
      productName: row.productName,
      description: row.description,
      imageUrls: (row.images ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((img) => img.url),
      quantity: row.quantity,
      unit: row.unit,
      costPriceCny: numFromDecimal(row.costPriceCny),
      grossWeightKg: row.grossWeightKg != null ? numFromDecimal(row.grossWeightKg) : null,
      volumeM3: row.volumeM3 != null ? numFromDecimal(row.volumeM3) : null,
      offerUnitPrice: numFromDecimal(row.offerUnitPrice),
      deliveryEta: row.deliveryEta,
    };
  }

  private resolveOfferUnitPriceRubFromCalc(
    calcIn: PricingProfileCalcInput,
    l: Pick<SourcingCommercialProposalLineInputDto, 'costPriceCny' | 'grossWeightKg' | 'volumeM3'>,
  ): number {
    const costPriceCny = Number.isFinite(l.costPriceCny) ? l.costPriceCny! : 0;
    if (costPriceCny <= 0) return 0;
    const { weightKg, volumeM3 } = resolveSourcingTypicalDims(l.grossWeightKg, l.volumeM3);
    const forward = forwardRetailFromProfileCalc(calcIn, { costPriceCny, weightKg, volumeM3 });
    if (!forward.ok) {
      throw new BadRequestException('Некорректные ¥, вес или объём для расчёта цены');
    }
    return forward.retailRub;
  }

  private async requireDefaultProfileCalcContext() {
    const ctx = await this.pricingAdmin.loadDefaultProfileCalcContext();
    if (!ctx.ok) {
      throw new BadRequestException('Нет основного профиля ценообразования для расчёта цены в ₽');
    }
    return ctx;
  }

  private buildLineCreatesFromRequestItems(
    request: RequestForKpInit,
    calcIn: PricingProfileCalcInput,
  ): Prisma.SourcingCommercialProposalLineCreateWithoutProposalInput[] {
    const productCount = request.items.length;
    const lines: Prisma.SourcingCommercialProposalLineCreateWithoutProposalInput[] = [];

    for (let i = 0; i < request.items.length; i++) {
      const item = request.items[i]!;
      const productName = resolveSourcingProductDisplayName({
        name: item.name,
        requestTitle: request.title,
        productIndex: i,
        productCount,
      });

      let costPriceCny = 0;
      let offerUnitPrice = 0;
      const retailRub = parseExpectedBudgetRetailRub(item.expectedBudget);
      if (retailRub != null) {
        const reverse = reverseRetailToCnyFromProfileCalc(calcIn, { retailRub });
        if (reverse.ok) {
          costPriceCny = reverse.costPriceCny;
          const forward = forwardRetailFromProfileCalc(calcIn, {
            costPriceCny,
            weightKg: TYPICAL_SOURCING_WEIGHT_KG,
            volumeM3: TYPICAL_SOURCING_VOLUME_M3,
          });
          if (forward.ok) offerUnitPrice = forward.retailRub;
        }
      }

      lines.push({
        sourceSourcingRequestItemId: item.id,
        sortOrder: item.sortOrder,
        productName,
        description: item.description?.trim() || null,
        quantity: Math.max(1, item.quantity),
        unit: (item.unit?.trim() || 'шт').slice(0, 32),
        costPriceCny: decCny(costPriceCny),
        grossWeightKg: dec3(TYPICAL_SOURCING_WEIGHT_KG),
        volumeM3: dec6(TYPICAL_SOURCING_VOLUME_M3),
        offerUnitPrice: dec(offerUnitPrice),
        deliveryEta: null,
      });
    }

    return lines;
  }

  private async loadRequestForKpInit(sourcingRequestId: string): Promise<RequestForKpInit> {
    return this.prisma.sourcingRequest.findUniqueOrThrow({
      where: { id: sourcingRequestId },
      select: REQUEST_FOR_KP_INIT_SELECT,
    });
  }

  private async seedEmptyDraftFromRequest(
    proposalId: string,
    sourcingRequestId: string,
  ) {
    const request = await this.loadRequestForKpInit(sourcingRequestId);
    const calcCtx = await this.requireDefaultProfileCalcContext();
    const lineCreates = this.buildLineCreatesFromRequestItems(request, calcCtx.calcIn);
    if (lineCreates.length === 0) return null;

    return this.prisma.sourcingCommercialProposal.update({
      where: { id: proposalId },
      data: {
        lines: {
          deleteMany: {},
          create: lineCreates,
        },
      },
      include: { lines: KP_LINES_INCLUDE },
    });
  }

  private serializeProposal(p: {
    id: string;
    sourcingRequestId: string;
    versionNumber: number;
    status: CommercialProposalStatus;
    publishedAt: Date | null;
    publishedByUserId: string | null;
    pricingProfileUpdatedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<Parameters<SourcingCommercialProposalService['serializeLine']>[0]>;
  }) {
    return {
      id: p.id,
      sourcingRequestId: p.sourcingRequestId,
      versionNumber: p.versionNumber,
      status: p.status,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      publishedByUserId: p.publishedByUserId,
      pricingProfileUpdatedAt: p.pricingProfileUpdatedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      lines: p.lines.map((l) => this.serializeLine(l)),
    };
  }

  async getSummary(sourcingRequestId: string) {
    await this.assertRequestForKp(sourcingRequestId);
    const [draft, published] = await Promise.all([
      this.prisma.sourcingCommercialProposal.findFirst({
        where: {
          sourcingRequestId,
          versionNumber: 0,
          status: CommercialProposalStatus.DRAFT,
        },
        select: {
          id: true,
          updatedAt: true,
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.sourcingCommercialProposal.findMany({
        where: { sourcingRequestId, status: CommercialProposalStatus.PUBLISHED },
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

  async getDraft(sourcingRequestId: string) {
    await this.assertRequestForKp(sourcingRequestId);
    const draft = await this.prisma.sourcingCommercialProposal.findFirst({
      where: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
      },
      include: { lines: KP_LINES_INCLUDE },
    });
    if (!draft) throw new NotFoundException('Черновик КП не найден');
    return this.serializeProposal(draft);
  }

  async getPublished(sourcingRequestId: string, versionNumber: number) {
    await this.assertRequestForKp(sourcingRequestId);
    if (versionNumber < 1) throw new BadRequestException('Некорректная версия');
    const p = await this.prisma.sourcingCommercialProposal.findFirst({
      where: {
        sourcingRequestId,
        versionNumber,
        status: CommercialProposalStatus.PUBLISHED,
      },
      include: { lines: KP_LINES_INCLUDE },
    });
    if (!p) throw new NotFoundException('Версия КП не найдена');
    return this.serializeProposal(p);
  }

  private async deleteDraftTx(tx: Prisma.TransactionClient, sourcingRequestId: string) {
    await tx.sourcingCommercialProposal.deleteMany({
      where: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
      },
    });
  }

  async initDraft(sourcingRequestId: string, dto?: InitSourcingCommercialProposalDraftDto) {
    await this.assertRequestForKp(sourcingRequestId);

    if (dto?.fromPublishedProposalId?.trim()) {
      const pub = await this.prisma.sourcingCommercialProposal.findFirst({
        where: {
          id: dto.fromPublishedProposalId.trim(),
          sourcingRequestId,
          status: CommercialProposalStatus.PUBLISHED,
        },
        include: { lines: KP_LINES_INCLUDE },
      });
      if (!pub) throw new NotFoundException('Опубликованное КП не найдено');

      return this.prisma.$transaction(async (tx) => {
        await this.deleteDraftTx(tx, sourcingRequestId);
        const created = await tx.sourcingCommercialProposal.create({
          data: {
            sourcingRequestId,
            versionNumber: 0,
            status: CommercialProposalStatus.DRAFT,
            lines: {
              create: pub.lines.map((l) => ({
                sourceSourcingRequestItemId: l.sourceSourcingRequestItemId,
                sortOrder: l.sortOrder,
                productName: l.productName,
                description: l.description,
                quantity: l.quantity,
                unit: l.unit.slice(0, 32),
                costPriceCny: l.costPriceCny,
                grossWeightKg: l.grossWeightKg,
                volumeM3: l.volumeM3,
                offerUnitPrice: l.offerUnitPrice,
                deliveryEta: l.deliveryEta,
                images: {
                  create: (l.images ?? []).map((img, sortOrder) => ({
                    url: img.url,
                    sortOrder: img.sortOrder ?? sortOrder,
                  })),
                },
              })),
            },
          },
          include: { lines: KP_LINES_INCLUDE },
        });
        return this.serializeProposal(created);
      });
    }

    const existing = await this.prisma.sourcingCommercialProposal.findFirst({
      where: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
      },
      include: { lines: KP_LINES_INCLUDE },
    });
    if (existing) {
      if (existing.lines.length > 0) return this.serializeProposal(existing);
      const seeded = await this.seedEmptyDraftFromRequest(existing.id, sourcingRequestId);
      return this.serializeProposal(seeded ?? existing);
    }

    const request = await this.loadRequestForKpInit(sourcingRequestId);
    const calcCtx = await this.requireDefaultProfileCalcContext();
    const lineCreates = this.buildLineCreatesFromRequestItems(request, calcCtx.calcIn);

    const created = await this.prisma.sourcingCommercialProposal.create({
      data: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
        ...(lineCreates.length > 0 ? { lines: { create: lineCreates } } : {}),
      },
      include: { lines: KP_LINES_INCLUDE },
    });
    return this.serializeProposal(created);
  }

  async putDraft(sourcingRequestId: string, lines: SourcingCommercialProposalLineInputDto[]) {
    await this.assertRequestForKp(sourcingRequestId);
    const draft = await this.prisma.sourcingCommercialProposal.findFirst({
      where: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
      },
    });
    if (!draft) throw new NotFoundException('Сначала создайте черновик КП');

    const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
    const calcCtx = await this.requireDefaultProfileCalcContext();

    await this.prisma.$transaction(async (tx) => {
      await tx.sourcingCommercialProposalLine.deleteMany({ where: { proposalId: draft.id } });
      for (const l of sorted) {
        const name = l.productName?.trim();
        if (!name) throw new BadRequestException('У каждой строки должно быть название товара');
        const offerUnitPrice = this.resolveOfferUnitPriceRubFromCalc(calcCtx.calcIn, l);
        const { weightKg, volumeM3 } = resolveSourcingTypicalDims(l.grossWeightKg, l.volumeM3);
        await tx.sourcingCommercialProposalLine.create({
          data: {
            proposalId: draft.id,
            sourceSourcingRequestItemId: l.sourceSourcingRequestItemId?.trim() || null,
            sortOrder: l.sortOrder,
            productName: name,
            description: l.description?.trim() || null,
            quantity: Math.max(1, Math.floor(l.quantity)),
            unit: (l.unit?.trim() || 'шт').slice(0, 32),
            costPriceCny: decCny(l.costPriceCny ?? 0),
            grossWeightKg: dec3(weightKg),
            volumeM3: dec6(volumeM3),
            offerUnitPrice: dec(offerUnitPrice),
            deliveryEta: l.deliveryEta?.trim() || null,
            images: { create: lineImageCreates(l.imageUrls) },
          },
        });
      }
    });

    const full = await this.prisma.sourcingCommercialProposal.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: KP_LINES_INCLUDE },
    });
    return this.serializeProposal(full);
  }

  async publish(sourcingRequestId: string, staffUserId: string) {
    await this.assertRequestForKp(sourcingRequestId);
    const draft = await this.prisma.sourcingCommercialProposal.findFirst({
      where: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
      },
      include: { lines: true },
    });
    if (!draft) throw new BadRequestException('Нет черновика КП');
    if (draft.lines.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одну позицию в КП');
    }

    for (const l of draft.lines) {
      const cny = numFromDecimal(l.costPriceCny);
      if (cny <= 0) {
        throw new BadRequestException(`Укажите цену в ¥ для «${l.productName.trim() || 'позиции'}»`);
      }
    }

    const calcCtx = await this.requireDefaultProfileCalcContext();
    const sourceItemIds = draft.lines
      .map((l) => l.sourceSourcingRequestItemId)
      .filter((id): id is string => Boolean(id?.trim()));
    const budgetByItemId = new Map<string, number>();
    if (sourceItemIds.length > 0) {
      const requestItems = await this.prisma.sourcingRequestItem.findMany({
        where: { requestId: sourcingRequestId, id: { in: sourceItemIds } },
        select: { id: true, expectedBudget: true },
      });
      for (const item of requestItems) {
        const budget = parseExpectedBudgetRetailRub(item.expectedBudget);
        if (budget != null) budgetByItemId.set(item.id, budget);
      }
    }

    const warnings: string[] = [];
    const snapshotPrices = draft.lines.map((l) => {
      const offerUnitPrice = this.resolveOfferUnitPriceRubFromCalc(calcCtx.calcIn, {
        costPriceCny: numFromDecimal(l.costPriceCny),
        grossWeightKg: l.grossWeightKg != null ? numFromDecimal(l.grossWeightKg) : null,
        volumeM3: l.volumeM3 != null ? numFromDecimal(l.volumeM3) : null,
      });
      const sourceId = l.sourceSourcingRequestItemId?.trim();
      if (sourceId) {
        const budget = budgetByItemId.get(sourceId);
        if (budget != null && offerUnitPrice > budget) {
          warnings.push(
            `«${l.productName.trim()}»: цена ${offerUnitPrice} ₽ выше бюджета клиента ${budget} ₽`,
          );
        }
      }
      return { lineId: l.id, offerUnitPrice };
    });
    for (const w of warnings) this.logger.warn(`КП publish ${sourcingRequestId}: ${w}`);

    const maxRow = await this.prisma.sourcingCommercialProposal.aggregate({
      where: { sourcingRequestId, versionNumber: { gt: 0 } },
      _max: { versionNumber: true },
    });
    const nextVersion = (maxRow._max.versionNumber ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      for (const snap of snapshotPrices) {
        await tx.sourcingCommercialProposalLine.update({
          where: { id: snap.lineId },
          data: { offerUnitPrice: dec(snap.offerUnitPrice) },
        });
      }

      await tx.sourcingCommercialProposal.update({
        where: { id: draft.id },
        data: {
          versionNumber: nextVersion,
          status: CommercialProposalStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedByUserId: staffUserId,
          pricingProfileUpdatedAt: calcCtx.profileUpdatedAt,
        },
      });

      const lineCopies = await tx.sourcingCommercialProposalLine.findMany({
        where: { proposalId: draft.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { images: { orderBy: { sortOrder: 'asc' } } },
      });

      await tx.sourcingCommercialProposal.create({
        data: {
          sourcingRequestId,
          versionNumber: 0,
          status: CommercialProposalStatus.DRAFT,
          lines: {
            create: lineCopies.map((l) => ({
              sourceSourcingRequestItemId: l.sourceSourcingRequestItemId,
              sortOrder: l.sortOrder,
              productName: l.productName,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              costPriceCny: l.costPriceCny,
              grossWeightKg: l.grossWeightKg,
              volumeM3: l.volumeM3,
              offerUnitPrice: l.offerUnitPrice,
              deliveryEta: l.deliveryEta,
              images: {
                create: (l.images ?? []).map((img, sortOrder) => ({
                  url: img.url,
                  sortOrder: img.sortOrder ?? sortOrder,
                })),
              },
            })),
          },
        },
      });
    });

    await this.prisma.sourcingRequest.update({
      where: { id: sourcingRequestId },
      data: { updatedAt: new Date() },
    });

    const summary = await this.getSummary(sourcingRequestId);
    return { versionNumber: nextVersion, summary, warnings };
  }

  /** Для клиента: последняя опубликованная версия КП по заявке. */
  async getLatestPublishedForSourcingRequest(sourcingRequestId: string) {
    const all = await this.getAllPublishedForSourcingRequest(sourcingRequestId);
    return all[0] ?? null;
  }

  /** Для клиента: все опубликованные версии КП (новые первыми). */
  async getAllPublishedForSourcingRequest(sourcingRequestId: string) {
    const proposals = await this.prisma.sourcingCommercialProposal.findMany({
      where: { sourcingRequestId, status: CommercialProposalStatus.PUBLISHED },
      orderBy: { versionNumber: 'desc' },
      include: { lines: KP_LINES_INCLUDE },
    });
    return proposals.map((p) => this.serializeProposal(p));
  }

  async getLatestPublishedForUserSourcingRequest(userId: string, sourcingRequestId: string) {
    const all = await this.getAllPublishedForUserSourcingRequest(userId, sourcingRequestId);
    return all[0] ?? null;
  }

  async getAllPublishedForUserSourcingRequest(userId: string, sourcingRequestId: string) {
    const row = await this.prisma.sourcingRequest.findFirst({
      where: { id: sourcingRequestId, userId },
      select: { id: true, status: true },
    });
    if (!row) return [];
    if (row.status === SourcingRequestStatus.PENDING_REVIEW) return [];
    return this.getAllPublishedForSourcingRequest(sourcingRequestId);
  }
}
