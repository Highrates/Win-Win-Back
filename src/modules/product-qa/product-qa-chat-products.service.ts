import { Injectable } from '@nestjs/common';
import { Prisma, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { previewCorrespondenceBody } from '../product-correspondence/product-correspondence.mapper';
import { ProductQaCoreService } from './product-qa-core.service';
import {
  PRODUCT_QA_CHAT_PRODUCTS_DEFAULT_LIMIT,
  PRODUCT_QA_CHAT_PRODUCTS_MAX_LIMIT,
} from './product-qa.constants';
import { ProductQaQueueMetricsService } from './product-qa-queue-metrics.service';
import type { ProductQaChatProductsListOut } from './product-qa.types';

type PreviewMeta = {
  preview: string;
  authorRole: ProductQaAuthorRole | null;
  lastAt: Date;
};

export type ListChatProductsOpts = {
  limit?: number;
  cursor?: string;
};

@Injectable()
export class ProductQaChatProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly queueMetrics: ProductQaQueueMetricsService,
  ) {}

  async listChatProducts(
    staffUserId: string,
    staffRole: string,
    opts?: ListChatProductsOpts,
  ): Promise<ProductQaChatProductsListOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);

    const limit = Math.min(
      Math.max(opts?.limit ?? PRODUCT_QA_CHAT_PRODUCTS_DEFAULT_LIMIT, 1),
      PRODUCT_QA_CHAT_PRODUCTS_MAX_LIMIT,
    );
    const cursor = parseCursor(opts?.cursor);

    const where: Prisma.ProductWhereInput = {
      lastChatActivityAt: { not: null },
      ...(cursor
        ? {
            OR: [
              { lastChatActivityAt: { lt: new Date(cursor.at) } },
              {
                AND: [
                  { lastChatActivityAt: new Date(cursor.at) },
                  { id: { lt: cursor.productId } },
                ],
              },
            ],
          }
        : {}),
    };

    const pageRows = await this.prisma.product.findMany({
      where,
      orderBy: [{ lastChatActivityAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        slug: true,
        name: true,
        lastChatActivityAt: true,
        images: {
          take: 1,
          orderBy: { sortOrder: 'asc' },
          select: { url: true },
        },
      },
    });

    const hasMore = pageRows.length > limit;
    const rows = hasMore ? pageRows.slice(0, limit) : pageRows;
    const productIds = rows.map((r) => r.id);

    const [pendingByProduct, previewByProduct] = await Promise.all([
      productIds.length
        ? this.queueMetrics.pendingCountsByProductId(productIds)
        : Promise.resolve(new Map()),
      this.loadPreviewMeta(productIds),
    ]);

    const items = rows.map((row) => {
      const pending = pendingByProduct.get(row.id);
      const preview = previewByProduct.get(row.id);
      const lastMessageAt = row.lastChatActivityAt ?? preview?.lastAt ?? new Date(0);
      return {
        productId: row.id,
        productSlug: row.slug,
        productName: row.name,
        productImageUrl: row.images[0]?.url ?? null,
        lastMessageAt: lastMessageAt.toISOString(),
        lastMessagePreview: preview?.preview ?? '',
        publicQaPending: pending?.publicQaPending ?? 0,
        correspondenceAwaitingPublish: pending?.correspondenceAwaitingPublish ?? 0,
        awaitingStaffReply: preview?.authorRole === ProductQaAuthorRole.USER,
      };
    });

    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last?.lastChatActivityAt
        ? encodeCursor(last.lastChatActivityAt, last.id)
        : null;

    return { items, hasMore, nextCursor };
  }

  private async loadPreviewMeta(productIds: string[]): Promise<Map<string, PreviewMeta>> {
    if (!productIds.length) return new Map();

    const [correspondences, qaRows] = await Promise.all([
      this.prisma.productCorrespondence.findMany({
        where: { productId: { in: productIds } },
        select: {
          productId: true,
          lastMessageAt: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, authorRole: true, createdAt: true },
          },
        },
      }),
      this.prisma.$queryRaw<
        Array<{
          productId: string;
          body: string;
          authorRole: ProductQaAuthorRole;
          createdAt: Date;
        }>
      >`
        SELECT DISTINCT ON (t."productId")
          t."productId",
          m.body,
          m."authorRole",
          m."createdAt"
        FROM "ProductQaMessage" m
        INNER JOIN "ProductQaThread" t ON t.id = m."threadId"
        WHERE t."productId" IN (${Prisma.join(productIds)})
          AND m.status IN (
            ${ProductQaMessageStatus.VISIBLE}::"ProductQaMessageStatus",
            ${ProductQaMessageStatus.PENDING}::"ProductQaMessageStatus",
            ${ProductQaMessageStatus.HIDDEN}::"ProductQaMessageStatus",
            ${ProductQaMessageStatus.REJECTED}::"ProductQaMessageStatus"
          )
        ORDER BY t."productId", m."createdAt" DESC
      `,
    ]);

    const byProduct = new Map<string, PreviewMeta>();

    const upsert = (
      productId: string,
      lastAt: Date,
      preview: string,
      authorRole: ProductQaAuthorRole | null,
    ) => {
      const existing = byProduct.get(productId);
      if (existing && existing.lastAt >= lastAt) return;
      byProduct.set(productId, { lastAt, preview, authorRole });
    };

    for (const row of correspondences) {
      const last = row.messages[0];
      if (!last) continue;
      upsert(
        row.productId,
        row.lastMessageAt,
        previewCorrespondenceBody(last.body),
        last.authorRole,
      );
    }

    for (const row of qaRows) {
      upsert(row.productId, row.createdAt, previewCorrespondenceBody(row.body), row.authorRole);
    }

    return byProduct;
  }
}

function encodeCursor(at: Date, productId: string): string {
  return `${at.toISOString()}|${productId}`;
}

function parseCursor(raw: string | undefined): { at: number; productId: string } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const sep = trimmed.indexOf('|');
  if (sep <= 0) return null;
  const at = Date.parse(trimmed.slice(0, sep));
  const productId = trimmed.slice(sep + 1).trim();
  if (!Number.isFinite(at) || !productId) return null;
  return { at, productId };
}
