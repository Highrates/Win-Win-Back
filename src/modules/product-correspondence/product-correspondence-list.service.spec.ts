import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaAuthorRole } from '@prisma/client';
import { ProductCorrespondenceListService } from './product-correspondence-list.service';

describe('ProductCorrespondenceListService', () => {
  const core = {
    resolveActiveProductBySlug: vi.fn(),
    resolveOrCreateCorrespondence: vi.fn(),
    getCorrespondenceForCustomer: vi.fn(),
    resolveProductById: vi.fn(),
    normalizePageLimit: vi.fn((n?: number) => n ?? 30),
  };

  const prisma = {
    productCorrespondence: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    productCorrespondenceMessage: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  };

  let service: ProductCorrespondenceListService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductCorrespondenceListService(prisma as never, core as never);
  });

  it('listMyProducts sets awaitingStaffReply when last message is USER', async () => {
    prisma.productCorrespondence.findMany.mockResolvedValue([
      {
        id: 'corr1',
        lastMessageAt: new Date('2026-08-10T10:00:00.000Z'),
        product: {
          id: 'p1',
          slug: 'chair',
          name: 'Стул',
          isActive: true,
          images: [],
        },
        messages: [{ body: 'Вопрос?', authorRole: ProductQaAuthorRole.USER }],
      },
    ]);
    prisma.productCorrespondenceMessage.findMany.mockResolvedValue([
      { correspondenceId: 'corr1' },
    ]);

    const out = await service.listMyProducts('u1');

    expect(out.items).toHaveLength(1);
    expect(out.items[0].awaitingStaffReply).toBe(true);
    expect(out.items[0].hasStaffReply).toBe(true);
    expect(prisma.productCorrespondenceMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ correspondenceId: { in: ['corr1'] } }),
        distinct: ['correspondenceId'],
      }),
    );
  });

  it('listMyProducts clears awaitingStaffReply when last message is STAFF', async () => {
    prisma.productCorrespondence.findMany.mockResolvedValue([
      {
        id: 'corr1',
        lastMessageAt: new Date('2026-08-10T11:00:00.000Z'),
        product: {
          id: 'p1',
          slug: 'chair',
          name: 'Стул',
          isActive: true,
          images: [],
        },
        messages: [{ body: 'Ответ магазина', authorRole: ProductQaAuthorRole.STAFF }],
      },
    ]);
    prisma.productCorrespondenceMessage.findMany.mockResolvedValue([
      { correspondenceId: 'corr1' },
    ]);

    const out = await service.listMyProducts('u1');

    expect(out.items[0].awaitingStaffReply).toBe(false);
    expect(out.items[0].hasStaffReply).toBe(true);
  });

  it('listThreadsForProduct batches unpublished counts', async () => {
    core.resolveProductById.mockResolvedValue({ id: 'p1' });
    prisma.productCorrespondence.findMany.mockResolvedValue([
      {
        id: 'corr1',
        customerUserId: 'u1',
        lastMessageAt: new Date('2026-08-10T10:00:00.000Z'),
        customer: { profile: { firstName: 'Ann', lastName: null } },
        messages: [{ body: 'Вопрос?' }],
      },
    ]);
    prisma.productCorrespondenceMessage.groupBy.mockResolvedValue([
      { correspondenceId: 'corr1', _count: { _all: 2 } },
    ]);

    const out = await service.listThreadsForProduct('p1');

    expect(out.items[0].unpublishedCount).toBe(2);
    expect(prisma.productCorrespondenceMessage.groupBy).toHaveBeenCalledTimes(1);
  });
});
