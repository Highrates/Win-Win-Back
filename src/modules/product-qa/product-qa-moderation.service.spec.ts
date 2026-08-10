import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductQaAuthorRole,
  ProductQaMessageStatus,
  UserRole,
} from '@prisma/client';
import { PRODUCT_QA_DEFAULT_TOPIC_SLUG } from './product-qa.constants';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaModerationService } from './product-qa-moderation.service';

function buildModerationService() {
  const prisma = {
    product: { update: vi.fn(), findUnique: vi.fn() },
    productQaMessage: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      groupBy: vi.fn(),
    },
    productQaThread: { findMany: vi.fn(), update: vi.fn() },
    productCorrespondenceMessage: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const staffAccess = {
    assertStaffCanAccessSection: vi.fn(async () => undefined),
  };
  const config = { get: vi.fn(() => undefined) };
  const core = new ProductQaCoreService(prisma as never, staffAccess as never, config as never);
  const searchSync = { scheduleProductReindex: vi.fn() };
  const gateway = {
    broadcastMessageHidden: vi.fn(),
    broadcastMessageCreated: vi.fn(),
    broadcastMessageUpdated: vi.fn(),
    broadcastMetaUpdated: vi.fn(),
  };
  const broadcast = { broadcastMeta: vi.fn(async () => undefined) };
  const notify = { scheduleCustomerNotifyForQaReject: vi.fn() };
  const storage = {
    tryPublicUrlToKey: vi.fn((url: string) => {
      const idx = url.indexOf('objects/product-qa/');
      return idx >= 0 ? url.slice(idx) : null;
    }),
    removeObjectKey: vi.fn(async () => undefined),
  };

  const service = new ProductQaModerationService(
    prisma as never,
    core,
    searchSync as never,
    gateway as never,
    broadcast as never,
    notify as never,
    storage as never,
  );
  return { service, prisma, gateway, broadcast, storage, notify };
}

const messageRow = {
  id: 'm1',
  threadId: 't1',
  authorUserId: 'u1',
  authorRole: ProductQaAuthorRole.USER,
  body: 'Q',
  productVariantId: null,
  status: ProductQaMessageStatus.VISIBLE,
  createdAt: new Date('2026-08-09T10:00:00.000Z'),
  author: {
    staffDisplayName: null,
    staffAvatarUrl: null,
    profile: { firstName: 'Ann', lastName: null, avatarUrl: null },
  },
  productVariant: null,
  thread: { slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG, title: 'Общие вопросы' },
  attachments: [{ url: 'https://cdn.test/objects/product-qa/p1/a.jpg' }],
};

describe('ProductQaModerationService', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockTxBasics(prisma: ReturnType<typeof buildModerationService>['prisma']) {
    prisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
    prisma.productQaMessage.groupBy.mockResolvedValue([]);
    prisma.productQaThread.findMany.mockResolvedValue([{ id: 't1' }]);
  }

  it('setMessageStatus HIDDEN keeps S3 attachments', async () => {
    const { service, prisma, storage, gateway, broadcast } = buildModerationService();
    prisma.productQaMessage.findFirst.mockResolvedValue({
      id: 'm1',
      status: ProductQaMessageStatus.VISIBLE,
      threadId: 't1',
      attachments: [{ url: 'https://cdn.test/objects/product-qa/p1/a.jpg' }],
    });
    prisma.productQaMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.productQaMessage.findFirstOrThrow.mockResolvedValue({
      ...messageRow,
      status: ProductQaMessageStatus.HIDDEN,
    });
    mockTxBasics(prisma);

    await service.setMessageStatus(
      'p1',
      'm1',
      'staff1',
      UserRole.ADMIN,
      ProductQaMessageStatus.HIDDEN,
    );

    expect(storage.removeObjectKey).not.toHaveBeenCalled();
    expect(gateway.broadcastMessageHidden).toHaveBeenCalledWith('p1', { id: 'm1' });
    expect(broadcast.broadcastMeta).toHaveBeenCalledWith('p1');
  });

  it('setMessageStatus DELETED purges S3 attachments', async () => {
    const { service, prisma, storage, gateway } = buildModerationService();
    const url = 'https://cdn.test/objects/product-qa/p1/a.jpg';
    prisma.productQaMessage.findFirst.mockResolvedValue({
      id: 'm1',
      status: ProductQaMessageStatus.VISIBLE,
      threadId: 't1',
      attachments: [{ url }],
    });
    prisma.productQaMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.productQaMessage.findFirstOrThrow.mockResolvedValue({
      ...messageRow,
      status: ProductQaMessageStatus.DELETED,
      attachments: [{ url }],
    });
    mockTxBasics(prisma);

    await service.setMessageStatus(
      'p1',
      'm1',
      'staff1',
      UserRole.ADMIN,
      ProductQaMessageStatus.DELETED,
    );

    expect(storage.removeObjectKey).toHaveBeenCalledWith('objects/product-qa/p1/a.jpg');
    expect(gateway.broadcastMessageHidden).toHaveBeenCalled();
  });

  it('setMessageStatus rejects PENDING (use approve/reject)', async () => {
    const { service, prisma } = buildModerationService();
    prisma.productQaMessage.findFirst.mockResolvedValue({
      id: 'm1',
      status: ProductQaMessageStatus.PENDING,
      threadId: 't1',
      attachments: [],
    });

    await expect(
      service.setMessageStatus('p1', 'm1', 'staff1', UserRole.ADMIN, ProductQaMessageStatus.HIDDEN),
    ).rejects.toThrow('модерации');

    await expect(
      service.setMessageStatus('p1', 'm1', 'staff1', UserRole.ADMIN, ProductQaMessageStatus.DELETED),
    ).rejects.toThrow('модерации');
  });

  it('approvePendingMessage publishes to storefront', async () => {
    const { service, prisma, gateway, broadcast, storage } = buildModerationService();
    prisma.productQaMessage.findFirst.mockResolvedValue({
      id: 'm1',
      status: ProductQaMessageStatus.PENDING,
      threadId: 't1',
      attachments: [],
    });
    prisma.productQaMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.productQaMessage.findFirstOrThrow.mockResolvedValue({
      ...messageRow,
      status: ProductQaMessageStatus.VISIBLE,
    });
    mockTxBasics(prisma);

    const out = await service.approvePendingMessage('p1', 'm1', 'staff1', UserRole.ADMIN);

    expect(out.status).toBe('VISIBLE');
    expect(gateway.broadcastMessageCreated).toHaveBeenCalled();
    expect(broadcast.broadcastMeta).toHaveBeenCalledWith('p1');
    expect(storage.removeObjectKey).not.toHaveBeenCalled();
  });

  it('rejectPendingMessage rejects without deleting attachments', async () => {
    const { service, prisma, gateway, broadcast, storage, notify } = buildModerationService();
    const url = 'https://cdn.test/objects/product-qa/p1/a.jpg';
    prisma.productQaMessage.findFirst.mockResolvedValue({
      id: 'm1',
      status: ProductQaMessageStatus.PENDING,
      threadId: 't1',
      attachments: [{ url }],
    });
    prisma.productQaMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.productQaMessage.findFirstOrThrow.mockResolvedValue({
      ...messageRow,
      status: ProductQaMessageStatus.REJECTED,
      attachments: [{ url }],
    });
    mockTxBasics(prisma);

    const out = await service.rejectPendingMessage('p1', 'm1', 'staff1', UserRole.ADMIN);

    expect(out.status).toBe('REJECTED');
    expect(prisma.productCorrespondenceMessage.updateMany).toHaveBeenCalledWith({
      where: { publishedQaMessageId: 'm1' },
      data: { publishedQaMessageId: null },
    });
    expect(storage.removeObjectKey).not.toHaveBeenCalled();
    expect(gateway.broadcastMessageCreated).not.toHaveBeenCalled();
    expect(gateway.broadcastMessageUpdated).toHaveBeenCalled();
    expect(notify.scheduleCustomerNotifyForQaReject).toHaveBeenCalled();
    expect(broadcast.broadcastMeta).not.toHaveBeenCalled();
  });
});
