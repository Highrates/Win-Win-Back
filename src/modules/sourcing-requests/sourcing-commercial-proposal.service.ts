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
import { PrismaService } from '../../prisma/prisma.service';
import type {
  InitSourcingCommercialProposalDraftDto,
  SourcingCommercialProposalLineInputDto,
} from './dto/sourcing-commercial-proposal.dto';

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? n.toFixed(2) : '0');
}

function numFromDecimal(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

const KP_LINES_INCLUDE = {
  orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  include: { images: { orderBy: { sortOrder: 'asc' as const } } },
};

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

  constructor(private readonly prisma: PrismaService) {}

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
      offerUnitPrice: numFromDecimal(row.offerUnitPrice),
      deliveryEta: row.deliveryEta,
    };
  }

  private serializeProposal(p: {
    id: string;
    sourcingRequestId: string;
    versionNumber: number;
    status: CommercialProposalStatus;
    publishedAt: Date | null;
    publishedByUserId: string | null;
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
    if (existing) return this.serializeProposal(existing);

    const created = await this.prisma.sourcingCommercialProposal.create({
      data: {
        sourcingRequestId,
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.sourcingCommercialProposalLine.deleteMany({ where: { proposalId: draft.id } });
      for (const l of sorted) {
        const name = l.productName?.trim();
        if (!name) throw new BadRequestException('У каждой строки должно быть название товара');
        await tx.sourcingCommercialProposalLine.create({
          data: {
            proposalId: draft.id,
            sourceSourcingRequestItemId: l.sourceSourcingRequestItemId?.trim() || null,
            sortOrder: l.sortOrder,
            productName: name,
            description: l.description?.trim() || null,
            quantity: Math.max(1, Math.floor(l.quantity)),
            unit: (l.unit?.trim() || 'шт').slice(0, 32),
            offerUnitPrice: dec(l.offerUnitPrice),
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

    const maxRow = await this.prisma.sourcingCommercialProposal.aggregate({
      where: { sourcingRequestId, versionNumber: { gt: 0 } },
      _max: { versionNumber: true },
    });
    const nextVersion = (maxRow._max.versionNumber ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.sourcingCommercialProposal.update({
        where: { id: draft.id },
        data: {
          versionNumber: nextVersion,
          status: CommercialProposalStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedByUserId: staffUserId,
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
    return { versionNumber: nextVersion, summary };
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
