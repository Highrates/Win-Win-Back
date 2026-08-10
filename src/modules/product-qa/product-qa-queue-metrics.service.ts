import { Injectable } from '@nestjs/common';
import { Prisma, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ProductQaPendingCounts = {
  publicQaPending: number;
  correspondenceAwaitingPublish: number;
};

@Injectable()
export class ProductQaQueueMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async countGlobalPending(): Promise<ProductQaPendingCounts> {
    const byProduct = await this.pendingCountsByProductId();
    let publicQaPending = 0;
    let correspondenceAwaitingPublish = 0;
    for (const counts of byProduct.values()) {
      publicQaPending += counts.publicQaPending;
      correspondenceAwaitingPublish += counts.correspondenceAwaitingPublish;
    }
    return { publicQaPending, correspondenceAwaitingPublish };
  }

  /** Pending public Q&A + unpublished correspondence USER messages, keyed by productId. */
  async pendingCountsByProductId(
    productIds?: string[],
  ): Promise<Map<string, ProductQaPendingCounts>> {
    const ids = productIds?.filter(Boolean) ?? [];
    const productFilterPublic =
      ids.length > 0
        ? Prisma.sql`AND t."productId" IN (${Prisma.join(ids)})`
        : Prisma.empty;
    const productFilterCorrespondence =
      ids.length > 0
        ? Prisma.sql`AND c."productId" IN (${Prisma.join(ids)})`
        : Prisma.empty;

    const [publicRows, correspondenceRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ productId: string; cnt: number }>>`
        SELECT t."productId", COUNT(*)::int AS cnt
        FROM "ProductQaMessage" m
        INNER JOIN "ProductQaThread" t ON t.id = m."threadId"
        WHERE m.status = ${ProductQaMessageStatus.PENDING}::"ProductQaMessageStatus"
          AND m."authorRole" = ${ProductQaAuthorRole.USER}::"ProductQaAuthorRole"
          ${productFilterPublic}
        GROUP BY t."productId"
      `,
      this.prisma.$queryRaw<Array<{ productId: string; cnt: number }>>`
        SELECT c."productId", COUNT(*)::int AS cnt
        FROM "ProductCorrespondenceMessage" m
        INNER JOIN "ProductCorrespondence" c ON c.id = m."correspondenceId"
        WHERE m."authorRole" = ${ProductQaAuthorRole.USER}::"ProductQaAuthorRole"
          AND m."publishedQaMessageId" IS NULL
          ${productFilterCorrespondence}
        GROUP BY c."productId"
      `,
    ]);

    const byProduct = new Map<string, ProductQaPendingCounts>();

    const bump = (productId: string, field: keyof ProductQaPendingCounts, delta: number) => {
      const existing = byProduct.get(productId) ?? {
        publicQaPending: 0,
        correspondenceAwaitingPublish: 0,
      };
      existing[field] += delta;
      byProduct.set(productId, existing);
    };

    for (const row of publicRows) {
      bump(row.productId, 'publicQaPending', row.cnt);
    }
    for (const row of correspondenceRows) {
      bump(row.productId, 'correspondenceAwaitingPublish', row.cnt);
    }

    return byProduct;
  }
}
