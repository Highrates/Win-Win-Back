import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaMessageStatus } from '@prisma/client';
import { ProductQaListService } from './product-qa-list.service';

describe('ProductQaListService viewer pending', () => {
  const thread = { id: 't1', slug: 'general', title: 'General' };
  const core = {
    resolveActiveProductBySlug: vi.fn(async () => ({ id: 'p1', slug: 'chair' })),
    resolveProductById: vi.fn(),
    resolveThread: vi.fn(async () => thread),
    normalizePageLimit: vi.fn((n?: number) => n ?? 30),
    loadTopics: vi.fn(),
    buildMeta: vi.fn(),
  };
  const prisma = {
    productQaMessage: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(),
    },
  };

  beforeEach(() => vi.clearAllMocks());

  it('includes viewer own PENDING alongside VISIBLE for public list', async () => {
    const service = new ProductQaListService(prisma as never, core as never);
    await service.listMessagesBySlug('chair', { viewerUserId: 'u1', topicSlug: 'general' });

    expect(prisma.productQaMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          threadId: 't1',
          OR: [
            { status: ProductQaMessageStatus.VISIBLE },
            { status: ProductQaMessageStatus.PENDING, authorUserId: 'u1' },
            { status: ProductQaMessageStatus.REJECTED, authorUserId: 'u1' },
          ],
        }),
      }),
    );
  });

  it('returns only VISIBLE for anonymous viewer', async () => {
    const service = new ProductQaListService(prisma as never, core as never);
    await service.listMessagesBySlug('chair', { topicSlug: 'general' });

    expect(prisma.productQaMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          threadId: 't1',
          status: ProductQaMessageStatus.VISIBLE,
        }),
      }),
    );
  });
});
