import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaPendingSummaryService } from './product-qa-pending-summary.service';

describe('ProductQaPendingSummaryService', () => {
  const core = {
    assertStaffCatalogAccess: vi.fn(async () => undefined),
  };

  const prisma = {
    product: { findMany: vi.fn() },
  };

  const queueMetrics = {
    pendingCountsByProductId: vi.fn(),
  };

  let service: ProductQaPendingSummaryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductQaPendingSummaryService(
      prisma as never,
      core as never,
      queueMetrics as never,
    );
  });

  it('aggregates public PENDING and unpublished correspondence by product', async () => {
    queueMetrics.pendingCountsByProductId.mockResolvedValue(
      new Map([
        [
          'p1',
          { publicQaPending: 2, correspondenceAwaitingPublish: 1 },
        ],
      ]),
    );
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', slug: 'chair', name: 'Стул' },
    ]);

    const out = await service.getPendingSummary('staff1', 'ADMIN');

    expect(out.total).toBe(3);
    expect(out.publicQaPending).toBe(2);
    expect(out.correspondenceAwaitingPublish).toBe(1);
    expect(out.byProduct).toEqual([
      {
        productId: 'p1',
        productSlug: 'chair',
        productName: 'Стул',
        publicQaPending: 2,
        correspondenceAwaitingPublish: 1,
      },
    ]);
    expect(core.assertStaffCatalogAccess).toHaveBeenCalled();
  });
});
