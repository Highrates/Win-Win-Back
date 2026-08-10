import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { ProductCorrespondencePostService } from './product-correspondence-post.service';

const authorStub = {
  staffDisplayName: null,
  staffAvatarUrl: null,
  profile: { firstName: 'Ann', lastName: null, avatarUrl: null },
};

function correspondenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    correspondenceId: 'c1',
    authorUserId: 'u1',
    authorRole: ProductQaAuthorRole.USER,
    body: 'Question?',
    productVariantId: null,
    publishedQaMessageId: null,
    createdAt: new Date('2026-08-10T10:00:00.000Z'),
    editedAt: null,
    author: authorStub,
    productVariant: null,
    attachments: [],
    correspondence: { productId: 'p1', customerUserId: 'u1' },
    ...overrides,
  };
}

describe('ProductCorrespondencePostService.publishPairToQa', () => {
  const prisma = {
    productCorrespondenceMessage: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  const core = { assertStaffCatalogAccess: vi.fn(async () => undefined) };
  const qaCore = {
    resolveThread: vi.fn(async () => ({ id: 'thread1' })),
    lockProductForUpdate: vi.fn(),
    recalculatePublicCounts: vi.fn(),
    touchProductChatActivity: vi.fn(),
  };
  const gateway = { broadcastMessageCreated: vi.fn() };
  const broadcast = { broadcastMeta: vi.fn() };
  const searchSync = { scheduleProductReindex: vi.fn() };
  const config = { get: vi.fn() };

  let service: ProductCorrespondencePostService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductCorrespondencePostService(
      prisma as never,
      core as never,
      qaCore as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      broadcast as never,
      searchSync as never,
      config as never,
    );
  });

  it('rejects pair when messages are from different correspondences', async () => {
    prisma.productCorrespondenceMessage.findFirst
      .mockResolvedValueOnce({
        id: 'q1',
        correspondenceId: 'c1',
        authorRole: ProductQaAuthorRole.USER,
        publishedQaMessageId: null,
        createdAt: new Date('2026-08-10T10:00:00.000Z'),
        correspondence: { productId: 'p1' },
        attachments: [],
      })
      .mockResolvedValueOnce({
        id: 'a1',
        correspondenceId: 'c2',
        authorRole: ProductQaAuthorRole.STAFF,
        publishedQaMessageId: null,
        createdAt: new Date('2026-08-10T11:00:00.000Z'),
        correspondence: { productId: 'p1' },
        attachments: [],
      });

    await expect(
      service.publishPairToQa('p1', 'q1', 'a1', 'staff1', 'ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes USER+STAFF pair to storefront Q&A', async () => {
    const question = correspondenceRow({ id: 'q1' });
    const answer = correspondenceRow({
      id: 'a1',
      authorRole: ProductQaAuthorRole.STAFF,
      authorUserId: 'staff1',
      createdAt: new Date('2026-08-10T11:00:00.000Z'),
      author: { ...authorStub, profile: null, staffDisplayName: 'Staff', staffAvatarUrl: null },
    });
    prisma.productCorrespondenceMessage.findFirst
      .mockResolvedValueOnce(question)
      .mockResolvedValueOnce(answer);

    const updatedQuestion = {
      ...question,
      publishedQaMessageId: 'qa-q',
      publishedQaMessage: { status: ProductQaMessageStatus.VISIBLE },
    };
    const updatedAnswer = {
      ...answer,
      publishedQaMessageId: 'qa-a',
      publishedQaMessage: { status: ProductQaMessageStatus.VISIBLE },
    };
    const qaQuestion = {
      id: 'qa-q',
      status: ProductQaMessageStatus.VISIBLE,
      threadId: 'thread1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'Question?',
      productVariantId: null,
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      editedAt: null,
      replyToMessageId: null,
      author: authorStub,
      productVariant: null,
      attachments: [],
      thread: { slug: 'general', title: 'Общие', productId: 'p1' },
    };
    const qaAnswer = {
      ...qaQuestion,
      id: 'qa-a',
      authorRole: ProductQaAuthorRole.STAFF,
      authorUserId: 'staff1',
      replyToMessageId: 'qa-q',
      createdAt: new Date('2026-08-10T11:00:00.000Z'),
    };

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );

    prisma.productCorrespondenceMessage.update = vi
      .fn()
      .mockResolvedValueOnce(updatedQuestion)
      .mockResolvedValueOnce(updatedAnswer);

    vi.spyOn(service as never, 'createQaFromCorrespondence' as never)
      .mockResolvedValueOnce(qaQuestion as never)
      .mockResolvedValueOnce(qaAnswer as never);

    const out = await service.publishPairToQa('p1', 'q1', 'a1', 'staff1', 'ADMIN');

    expect(out.question.publishedQaMessageId).toBe('qa-q');
    expect(out.answer.publishedQaMessageId).toBe('qa-a');
    expect(qaCore.touchProductChatActivity).toHaveBeenCalledWith(
      prisma,
      'p1',
      qaAnswer.createdAt,
    );
    expect(gateway.broadcastMessageCreated).toHaveBeenCalledTimes(2);
    expect(searchSync.scheduleProductReindex).toHaveBeenCalledWith('p1');
  });
});

describe('ProductCorrespondencePostService.publishMessageToQa', () => {
  const prisma = {
    productCorrespondenceMessage: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  const core = { assertStaffCatalogAccess: vi.fn(async () => undefined) };
  const qaCore = {
    resolveThread: vi.fn(async () => ({ id: 'thread1' })),
    lockProductForUpdate: vi.fn(),
    recalculatePublicCounts: vi.fn(),
  };
  const gateway = { broadcastMessageCreated: vi.fn() };
  const broadcast = { broadcastMeta: vi.fn() };
  const searchSync = { scheduleProductReindex: vi.fn() };
  const config = { get: vi.fn() };

  let service: ProductCorrespondencePostService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProductCorrespondencePostService(
      prisma as never,
      core as never,
      qaCore as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      broadcast as never,
      searchSync as never,
      config as never,
    );
  });

  it('rejects single publish for STAFF message', async () => {
    prisma.productCorrespondenceMessage.findFirst.mockResolvedValueOnce({
      id: 'a1',
      correspondenceId: 'c1',
      authorRole: ProductQaAuthorRole.STAFF,
      publishedQaMessageId: null,
      correspondence: { customerUserId: 'u1' },
      attachments: [],
    });

    await expect(
      service.publishMessageToQa('p1', 'a1', 'staff1', 'ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes single USER question to storefront Q&A', async () => {
    const source = correspondenceRow({ id: 'q1' });
    prisma.productCorrespondenceMessage.findFirst.mockResolvedValueOnce(source);

    const qaMessage = {
      id: 'qa1',
      status: ProductQaMessageStatus.VISIBLE,
      threadId: 'thread1',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      body: 'Question?',
      productVariantId: null,
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      editedAt: null,
      replyToMessageId: null,
      author: authorStub,
      productVariant: null,
      attachments: [],
      thread: { slug: 'general', title: 'Общие', productId: 'p1' },
    };
    const updatedCorr = {
      ...source,
      publishedQaMessageId: 'qa1',
      publishedQaMessage: { status: ProductQaMessageStatus.VISIBLE },
    };

    prisma.$transaction.mockResolvedValue({ corr: updatedCorr, qaMessage });

    const out = await service.publishMessageToQa('p1', 'q1', 'staff1', 'ADMIN');

    expect(out.publishedQaMessageId).toBe('qa1');
    expect(out.isPublishedToStorefront).toBe(true);
    expect(gateway.broadcastMessageCreated).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ id: 'qa1', status: ProductQaMessageStatus.VISIBLE }),
    );
    expect(searchSync.scheduleProductReindex).toHaveBeenCalledWith('p1');
  });
});
