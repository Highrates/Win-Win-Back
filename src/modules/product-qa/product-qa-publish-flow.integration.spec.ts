import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaModerationService } from './product-qa-moderation.service';
import type { ProductQaNotifyService } from './product-qa-notify.service';

describe('Product QA publish flow (integration smoke)', () => {
  const notify = {
    scheduleCustomerNotifyForQaReject: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('reject pending publishes staff WS update and notifies customer', async () => {
    const prisma = {
      productQaMessage: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'm1',
          status: ProductQaMessageStatus.PENDING,
          threadId: 't1',
          attachments: [],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: 'm1',
          threadId: 't1',
          authorUserId: 'u1',
          authorRole: ProductQaAuthorRole.USER,
          body: 'Q?',
          productVariantId: null,
          status: ProductQaMessageStatus.REJECTED,
          createdAt: new Date('2026-08-10T10:00:00.000Z'),
          editedAt: null,
          replyToMessageId: null,
          author: {
            staffDisplayName: null,
            staffAvatarUrl: null,
            profile: { firstName: 'Ann', lastName: null, avatarUrl: null },
          },
          productVariant: null,
          thread: { slug: 'general', title: 'Общие', productId: 'p1' },
          attachments: [],
        }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      productQaThread: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
      productCorrespondenceMessage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'p1' }]),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const staffAccess = { assertStaffCanAccessSection: vi.fn(async () => undefined) };
    const config = { get: vi.fn(() => undefined) };
    const core = new ProductQaCoreService(prisma as never, staffAccess as never, config as never);
    const gateway = {
      broadcastMessageCreated: vi.fn(),
      broadcastMessageUpdated: vi.fn(),
      broadcastMessageHidden: vi.fn(),
    };
    const moderation = new ProductQaModerationService(
      prisma as never,
      core,
      { scheduleProductReindex: vi.fn() } as never,
      gateway as never,
      { broadcastMeta: vi.fn() } as never,
      notify as unknown as ProductQaNotifyService,
      {
        tryPublicUrlToKey: vi.fn(),
        removeObjectKey: vi.fn(),
      } as never,
    );

    const out = await moderation.rejectPendingMessage('p1', 'm1', 'staff1', 'ADMIN');

    expect(out.status).toBe('REJECTED');
    expect(gateway.broadcastMessageUpdated).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ id: 'm1', status: 'REJECTED' }),
    );
    expect(notify.scheduleCustomerNotifyForQaReject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ id: 'm1' }),
    );
  });
});
