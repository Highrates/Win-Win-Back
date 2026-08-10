import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaAuthorRole } from '@prisma/client';
import { ProductQaChatProductsService } from './product-qa-chat-products.service';

describe('ProductQaChatProductsService', () => {
  const core = {
    assertStaffCatalogAccess: vi.fn(async () => undefined),
  };

  const queueMetrics = {
    pendingCountsByProductId: vi.fn(async () => new Map()),
  };

  const prisma = {
    product: { findMany: vi.fn() },
    productCorrespondence: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };

  let service: ProductQaChatProductsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductQaChatProductsService(
      prisma as never,
      core as never,
      queueMetrics as never,
    );
  });

  it('returns products from DB pagination with preview metadata', async () => {
    const lastAt = new Date('2026-08-10T12:00:00.000Z');
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        slug: 'chair',
        name: 'Стул',
        lastChatActivityAt: lastAt,
        images: [{ url: '/img.jpg' }],
      },
    ]);
    prisma.productCorrespondence.findMany.mockResolvedValue([
      {
        productId: 'p1',
        lastMessageAt: lastAt,
        messages: [{ body: 'Hello', authorRole: ProductQaAuthorRole.USER, createdAt: lastAt }],
      },
    ]);
    prisma.$queryRaw.mockResolvedValue([]);

    const out = await service.listChatProducts('staff', 'ADMIN', { limit: 10 });

    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.productSlug).toBe('chair');
    expect(out.items[0]?.awaitingStaffReply).toBe(true);
    expect(out.hasMore).toBe(false);
    expect(out.nextCursor).toBeNull();
    expect(queueMetrics.pendingCountsByProductId).toHaveBeenCalledWith(['p1']);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastChatActivityAt: { not: null } }),
        orderBy: [{ lastChatActivityAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('passes cursor filter to product query', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.productCorrespondence.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);

    await service.listChatProducts('staff', 'ADMIN', {
      cursor: '2026-08-10T12:00:00.000Z|p2',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });
});
