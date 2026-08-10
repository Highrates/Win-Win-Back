import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { PRODUCT_QA_DEFAULT_TOPIC_SLUG } from './product-qa.constants';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaTopicService } from './product-qa-topic.service';

function buildTopicService() {
  const prisma = {
    product: { findUnique: vi.fn() },
    productQaThread: {
      upsert: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const staffAccess = {
    assertStaffCanAccessSection: vi.fn(async () => undefined),
  };
  const config = { get: vi.fn(() => undefined) };
  const core = new ProductQaCoreService(prisma as never, staffAccess as never, config as never);
  const broadcast = { broadcastMeta: vi.fn(async () => undefined) };
  const service = new ProductQaTopicService(prisma as never, core, broadcast as never);
  return { service, prisma, broadcast };
}

const defaultThread = {
  id: 't1',
  slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG,
  title: 'Общие вопросы',
  messageCountPublic: 0,
  isDefault: true,
  sortOrder: 0,
};

describe('ProductQaTopicService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createTopic adds non-default topic and broadcasts meta', async () => {
    const { service, prisma, broadcast } = buildTopicService();
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
    prisma.productQaThread.create.mockResolvedValue({
      id: 't2',
      slug: 'sizes',
      title: 'Размеры',
      messageCountPublic: 0,
      isDefault: false,
      sortOrder: 1,
    });

    const out = await service.createTopic('p1', 'staff1', UserRole.ADMIN, {
      title: 'Размеры',
      slug: 'sizes',
    });

    expect(out.slug).toBe('sizes');
    expect(out.title).toBe('Размеры');
    expect(broadcast.broadcastMeta).toHaveBeenCalledWith('p1');
  });
});
