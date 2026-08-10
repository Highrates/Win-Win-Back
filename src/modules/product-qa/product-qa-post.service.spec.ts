import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductQaAuthorRole, ProductQaMessageStatus, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_QA_DEFAULT_TOPIC_SLUG } from './product-qa.constants';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaPostService } from './product-qa-post.service';

function buildPostService() {
  const prisma = {
    product: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    productVariant: {
      findFirst: vi.fn(),
    },
    productQaThread: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      upsert: vi.fn(),
    },
    productQaMessage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    productQaAttachment: {
      count: vi.fn(),
    },
    productQaPendingUpload: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const staffAccess = {
    assertStaffCanAccessSection: vi.fn(async () => undefined),
  };
  const config = { get: vi.fn(() => undefined) };
  const core = new ProductQaCoreService(prisma as never, staffAccess as never, config as never);
  const storage = {
    assertLibraryFile: vi.fn(),
    libraryFileExtension: vi.fn(() => '.jpg'),
    uploadMediaLibraryObject: vi.fn(async () => ({ url: 'https://cdn.test/a.jpg' })),
    tryPublicUrlToKey: vi.fn((url: string) => {
      const idx = url.indexOf('objects/product-qa/');
      return idx >= 0 ? url.slice(idx) : null;
    }),
  };
  const captcha = {
    assertValidUserToken: vi.fn(async () => undefined),
    isRequiredForUserPosts: vi.fn(() => false),
  };
  const searchSync = {
    scheduleProductReindex: vi.fn(),
  };
  const gateway = {
    broadcastMessageCreated: vi.fn(),
    broadcastMessageHidden: vi.fn(),
    broadcastMetaUpdated: vi.fn(),
  };
  const notify = {
    scheduleStaffNotifyForUserQuestion: vi.fn(),
  };
  const broadcast = {
    broadcastMeta: vi.fn(async () => undefined),
  };

  const service = new ProductQaPostService(
    prisma as never,
    core,
    storage as never,
    captcha as never,
    searchSync as never,
    gateway as never,
    broadcast as never,
    notify as never,
    config as never,
  );
  return { service, prisma, core, captcha, gateway, searchSync, notify, broadcast, config };
}

const defaultThread = {
  id: 't1',
  slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG,
  title: 'Общие вопросы',
  messageCountPublic: 0,
};

describe('ProductQaPostService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockTxBasics(prisma: ReturnType<typeof buildPostService>['prisma']) {
    prisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
  }

  function mockCountRecalc(prisma: ReturnType<typeof buildPostService>['prisma'], threadId = 't1') {
    mockTxBasics(prisma);
    prisma.productQaMessage.groupBy.mockResolvedValue([{ threadId, _count: { _all: 1 } }]);
    prisma.productQaThread.findMany.mockResolvedValue([{ id: threadId }]);
  }

  it('postMessageBySlug rejects empty body without attachments', async () => {
    const { service, prisma } = buildPostService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);

    await expect(
      service.postMessageBySlug('chair', 'u1', UserRole.USER, { body: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('postMessageBySlug rejects attachment URL outside product prefix', async () => {
    const { service, prisma } = buildPostService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);

    await expect(
      service.postMessageBySlug('chair', 'u1', UserRole.USER, {
        body: 'см.',
        attachments: [
          {
            url: 'https://evil.example/secret.jpg',
            filename: 'secret.jpg',
            mimeType: 'image/jpeg',
            kind: 'IMAGE' as const,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('postMessageBySlug enforces cooldown per product', async () => {
    const { service, prisma } = buildPostService();
    mockTxBasics(prisma);
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.postMessageBySlug('chair', 'u1', UserRole.USER, { body: 'again' }),
    ).rejects.toThrow(/Подождите/);
  });

  it('postMessageBySlug rejects attachment without pending upload record', async () => {
    const { service, prisma } = buildPostService();
    mockTxBasics(prisma);
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaPendingUpload.findMany.mockResolvedValue([]);

    const url = 'https://cdn.test/objects/product-qa/p1/abc.jpg';
    await expect(
      service.postMessageBySlug('chair', 'u1', UserRole.USER, {
        body: 'см.',
        attachments: [
          {
            url,
            filename: 'abc.jpg',
            mimeType: 'image/jpeg',
            kind: 'IMAGE' as const,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('postMessageBySlug recalculates attachment metadata from pending upload', async () => {
    const { service, prisma } = buildPostService();
    mockTxBasics(prisma);
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue(null);
    const url = 'https://cdn.test/objects/product-qa/p1/abc.jpg';
    prisma.productQaPendingUpload.findMany.mockResolvedValue([
      { url, filename: 'server-name.jpg', mimeType: 'image/jpeg' },
    ]);
    prisma.productQaPendingUpload.deleteMany.mockResolvedValue({ count: 1 });
    prisma.productQaMessage.create.mockResolvedValue({
      id: 'm1',
      threadId: 't1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'см.',
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
      attachments: [
        {
          id: 'a1',
          url,
          filename: 'abc.jpg',
          mimeType: 'image/jpeg',
          kind: 'IMAGE',
        },
      ],
    });
    mockCountRecalc(prisma);

    await service.postMessageBySlug('chair', 'u1', UserRole.USER, {
      body: 'см.',
      attachments: [
        {
          url,
          filename: 'client-evil.pdf',
          mimeType: 'application/pdf',
          kind: 'FILE' as const,
        },
      ],
    });

    expect(prisma.productQaMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attachments: {
            create: [
              expect.objectContaining({
                kind: 'IMAGE',
                mimeType: 'image/jpeg',
                filename: 'server-name.jpg',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('postMessageBySlug rejects when pending consume count mismatches (race)', async () => {
    const { service, prisma } = buildPostService();
    mockTxBasics(prisma);
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue(null);
    const url = 'https://cdn.test/objects/product-qa/p1/abc.jpg';
    prisma.productQaPendingUpload.findMany.mockResolvedValue([
      { url, filename: 'a.jpg', mimeType: 'image/jpeg' },
    ]);
    prisma.productQaPendingUpload.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.postMessageBySlug('chair', 'u1', UserRole.USER, {
        body: 'см.',
        attachments: [{ url, filename: 'x', mimeType: 'image/jpeg' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('postMessageBySlug creates message and broadcasts', async () => {
    const { service, prisma, gateway, searchSync, notify, broadcast } = buildPostService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue(null);
    prisma.productQaMessage.create.mockResolvedValue({
      id: 'm1',
      threadId: 't1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'Размер?',
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
      attachments: [],
    });
    mockCountRecalc(prisma);

    const out = await service.postMessageBySlug('chair', 'u1', UserRole.USER, {
      body: 'Размер?',
    });

    expect(out.id).toBe('m1');
    expect(out.authorLabel).toBe('Ann');
    expect(gateway.broadcastMessageCreated).toHaveBeenCalled();
    expect(broadcast.broadcastMeta).toHaveBeenCalledWith('p1');
    expect(searchSync.scheduleProductReindex).toHaveBeenCalledWith('p1');
    expect(notify.scheduleStaffNotifyForUserQuestion).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'm1' }));
  });

  it('postMessageBySlug never exposes author email in label', async () => {
    const { service, prisma } = buildPostService();
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue(null);
    prisma.productQaMessage.create.mockResolvedValue({
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
        profile: null,
      },
      productVariant: null,
      thread: { slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG, title: 'Общие вопросы' },
      attachments: [],
    });
    mockCountRecalc(prisma);

    const out = await service.postMessageBySlug('chair', 'u1', UserRole.USER, { body: 'Q' });
    expect(out.authorLabel).toBe('Пользователь');
  });

  it('postMessageBySlug creates PENDING for USER when pre-moderation enabled', async () => {
    const { service, prisma, gateway, broadcast, config } = buildPostService();
    config.get.mockImplementation((key: string) =>
      key === 'PRODUCT_QA_PREMODERATION' ? '1' : undefined,
    );
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'chair' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
    prisma.productQaThread.upsert.mockResolvedValue(defaultThread);
    prisma.productQaThread.findUnique.mockResolvedValue(defaultThread);
    prisma.productQaMessage.findFirst.mockResolvedValue(null);
    prisma.productQaMessage.create.mockResolvedValue({
      id: 'm1',
      threadId: 't1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'Размер?',
      productVariantId: null,
      status: ProductQaMessageStatus.PENDING,
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
      author: {
        staffDisplayName: null,
        staffAvatarUrl: null,
        profile: { firstName: 'Ann', lastName: null, avatarUrl: null },
      },
      productVariant: null,
      thread: { slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG, title: 'Общие вопросы' },
      attachments: [],
    });
    mockCountRecalc(prisma);

    const out = await service.postMessageBySlug('chair', 'u1', UserRole.USER, {
      body: 'Размер?',
    });

    expect(out.status).toBe('PENDING');
    expect(gateway.broadcastMessageCreated).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ id: 'm1', status: 'PENDING' }),
    );
    expect(broadcast.broadcastMeta).not.toHaveBeenCalled();
  });

});

describe('ProductQaCoreService', () => {
  it('resolveActiveProductBySlug throws when product inactive', async () => {
    const prisma = { product: { findFirst: vi.fn().mockResolvedValue(null) } };
    const staffAccess = { assertStaffCanAccessSection: vi.fn() };
    const config = { get: vi.fn(() => undefined) };
    const core = new ProductQaCoreService(prisma as never, staffAccess as never, config as never);

    await expect(core.resolveActiveProductBySlug('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
