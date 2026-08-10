import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaQueueMetricsService } from './product-qa-queue-metrics.service';
import type { ProductQaPendingSummaryOut } from './product-qa.types';

@Injectable()
export class ProductQaPendingSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly queueMetrics: ProductQaQueueMetricsService,
  ) {}

  async getPendingSummary(
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaPendingSummaryOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);

    const pendingByProduct = await this.queueMetrics.pendingCountsByProductId();

    let publicQaPending = 0;
    let correspondenceAwaitingPublish = 0;
    for (const counts of pendingByProduct.values()) {
      publicQaPending += counts.publicQaPending;
      correspondenceAwaitingPublish += counts.correspondenceAwaitingPublish;
    }

    const productIds = Array.from(pendingByProduct.keys());
    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, slug: true, name: true },
          })
        : [];

    const productById = new Map(products.map((p) => [p.id, p]));

    const byProduct = Array.from(pendingByProduct.entries())
      .map(([productId, counts]) => {
        const product = productById.get(productId);
        if (!product) return null;
        return {
          productId,
          productSlug: product.slug,
          productName: product.name,
          publicQaPending: counts.publicQaPending,
          correspondenceAwaitingPublish: counts.correspondenceAwaitingPublish,
          total: counts.publicQaPending + counts.correspondenceAwaitingPublish,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => b.total - a.total || b.publicQaPending - a.publicQaPending)
      .map(({ total: _total, ...rest }) => rest);

    return {
      total: publicQaPending + correspondenceAwaitingPublish,
      publicQaPending,
      correspondenceAwaitingPublish,
      byProduct,
    };
  }
}
