import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaEditService } from './product-qa-edit.service';

describe('ProductQaEditService', () => {
  const prisma = {
    productQaMessage: { findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    productQaMessageRevision: { create: vi.fn(), findMany: vi.fn() },
    productCorrespondenceMessage: { findFirst: vi.fn(), update: vi.fn() },
    productCorrespondenceMessageRevision: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  const core = {
    resolveActiveProductBySlug: vi.fn(async () => ({ id: 'p1' })),
    assertStaffCatalogAccess: vi.fn(async () => undefined),
  };
  const gateway = {
    broadcastMessageUpdated: vi.fn(),
    broadcastCorrespondenceMessageUpdated: vi.fn(),
  };

  let service: ProductQaEditService;

  const baseMessage = {
    id: 'm1',
    authorUserId: 'u1',
    authorRole: ProductQaAuthorRole.USER,
    status: ProductQaMessageStatus.VISIBLE,
    body: 'Старый текст',
    createdAt: new Date(),
    threadId: 't1',
    thread: { slug: 'general', title: 'General' },
    author: {
      staffDisplayName: null,
      staffAvatarUrl: null,
      profile: { firstName: 'Ann', lastName: null, avatarUrl: null },
    },
    productVariant: null,
    replyTo: null,
    attachments: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductQaEditService(prisma as never, core as never, gateway as never);
  });

  it('rejects USER edit after window', async () => {
    prisma.productQaMessage.findFirst.mockResolvedValue({
      ...baseMessage,
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
    });

    await expect(
      service.editMessage('p1', 'm1', 'u1', 'USER', 'Новый'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects USER edit of foreign message', async () => {
    prisma.productQaMessage.findFirst.mockResolvedValue(baseMessage);

    await expect(
      service.editMessage('p1', 'm1', 'u2', 'USER', 'Новый'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('staff edit writes revision and broadcasts', async () => {
    prisma.productQaMessage.findFirst.mockResolvedValue({
      ...baseMessage,
      authorRole: ProductQaAuthorRole.STAFF,
    });
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        productQaMessageRevision: { create: vi.fn() },
        productQaMessage: {
          update: vi.fn().mockResolvedValue({
            ...baseMessage,
            body: 'Новый',
            editedAt: new Date(),
          }),
        },
        productCorrespondenceMessage: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
        productCorrespondenceMessageRevision: { create: vi.fn() },
      }),
    );

    const out = await service.editMessage('p1', 'm1', 's1', 'ADMIN', 'Новый');

    expect(out.body).toBe('Новый');
    expect(gateway.broadcastMessageUpdated).toHaveBeenCalledWith('p1', expect.objectContaining({ body: 'Новый' }));
  });

  it('staff edit syncs linked correspondence message', async () => {
    prisma.productQaMessage.findFirst.mockResolvedValue({
      ...baseMessage,
      authorRole: ProductQaAuthorRole.STAFF,
    });
    const corrUpdate = vi.fn();
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        productQaMessageRevision: { create: vi.fn() },
        productQaMessage: {
          update: vi.fn().mockResolvedValue({
            ...baseMessage,
            body: 'Новый',
            editedAt: new Date(),
          }),
        },
        productCorrespondenceMessage: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cm1',
            correspondenceId: 'corr1',
            body: 'Старый текст',
          }),
          update: corrUpdate,
        },
        productCorrespondenceMessageRevision: { create: vi.fn() },
      }),
    );
    prisma.productCorrespondenceMessage.findFirst.mockResolvedValue({
      id: 'cm1',
      correspondenceId: 'corr1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'Новый',
      editedAt: new Date(),
      publishedQaMessageId: 'm1',
      productVariantId: null,
      createdAt: new Date(),
      author: baseMessage.author,
      productVariant: null,
      attachments: [],
    });

    await service.editMessage('p1', 'm1', 's1', 'ADMIN', 'Новый');

    expect(corrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cm1' },
        data: expect.objectContaining({ body: 'Новый' }),
      }),
    );
    expect(gateway.broadcastCorrespondenceMessageUpdated).toHaveBeenCalledWith(
      'corr1',
      expect.objectContaining({ body: 'Новый' }),
    );
  });
});
