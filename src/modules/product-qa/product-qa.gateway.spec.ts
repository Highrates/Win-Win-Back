import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { ProductQaGateway } from './product-qa.gateway';
import { ROOM_STAFF_PRODUCT_QA, PRODUCT_QA_WS_STAFF_NEW_QUESTION, PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED, PRODUCT_QA_WS_STAFF_QA_MESSAGE_UPDATED, PRODUCT_QA_WS_MESSAGE_UPDATED } from './product-qa.constants';

describe('ProductQaGateway', () => {
  const jwt = { verify: vi.fn() };
  const core = {
    resolveJoinTarget: vi.fn(),
    resolveActiveProductBySlug: vi.fn(),
  };
  const staffAccess = { canAccessSection: vi.fn() };
  const correspondenceCore = {
    assertCorrespondenceAccess: vi.fn(),
  };

  let gateway: ProductQaGateway;
  let join: ReturnType<typeof vi.fn>;
  let leave: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let to: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new ProductQaGateway(
      jwt as never,
      core as never,
      correspondenceCore as never,
      staffAccess as never,
    );
    join = vi.fn().mockResolvedValue(undefined);
    leave = vi.fn().mockResolvedValue(undefined);
    emit = vi.fn();
    to = vi.fn(() => ({ emit }));
    gateway.server = { to } as never;
  });

  function client(authToken?: string) {
    return {
      handshake: {
        auth: authToken ? { token: authToken } : {},
        headers: {},
      },
      data: {} as Record<string, unknown>,
      join,
      leave,
    };
  }

  it('allows anonymous connection without token', async () => {
    await gateway.handleConnection(client() as never);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('join_product_qa joins room by slug', async () => {
    core.resolveJoinTarget.mockResolvedValue({ id: 'p1', slug: 'chair' });

    const res = await gateway.joinRoom(client() as never, { productSlug: 'chair' });

    expect(res).toEqual({ ok: true, productId: 'p1' });
    expect(join).toHaveBeenCalledWith('productQa:p1');
  });

  it('join_product_qa throws WsException when product missing', async () => {
    core.resolveJoinTarget.mockRejectedValue(new NotFoundException('Товар не найден'));

    await expect(gateway.joinRoom(client() as never, { productSlug: 'missing' })).rejects.toThrow(
      'Товар не найден',
    );
  });

  it('broadcastMessageCreated emits VISIBLE to product room', () => {
    const payload = {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие вопросы',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'User',
      authorAvatarUrl: null,
      body: 'Q?',
      productVariantId: null,
      variantLabel: null,
      status: ProductQaMessageStatus.VISIBLE,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: [],
      createdAt: '2026-08-09T10:00:00.000Z',
      editedAt: null,
    };

    gateway.broadcastMessageCreated('p1', payload);

    expect(to).toHaveBeenCalledWith('productQa:p1');
    expect(emit).toHaveBeenCalledWith('message_created', payload);
  });

  it('broadcastMessageCreated emits PENDING to staff room only', () => {
    const payload = {
      id: 'm2',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие вопросы',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'User',
      authorAvatarUrl: null,
      body: 'Pending?',
      productVariantId: null,
      variantLabel: null,
      status: ProductQaMessageStatus.PENDING,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: [],
      createdAt: '2026-08-09T10:00:00.000Z',
      editedAt: null,
    };

    gateway.broadcastMessageCreated('p1', payload);

    expect(to).toHaveBeenCalledWith(ROOM_STAFF_PRODUCT_QA);
    expect(emit).toHaveBeenCalledWith(PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED, {
      productId: 'p1',
      message: payload,
    });
    expect(to).not.toHaveBeenCalledWith('productQa:p1');
  });

  it('leave_product_qa leaves by productId', async () => {
    await gateway.leaveRoom(client() as never, { productId: 'p1' });
    expect(leave).toHaveBeenCalledWith('productQa:p1');
  });

  it('joins staff catalog room for admin with catalog access', async () => {
    jwt.verify.mockReturnValue({ sub: 's1', role: UserRole.ADMIN });
    staffAccess.canAccessSection.mockResolvedValue(true);
    const sock = client('token') as never;
    await gateway.handleConnection(sock);
    expect(join).toHaveBeenCalledWith(ROOM_STAFF_PRODUCT_QA);
  });

  it('broadcastMessageUpdated emits VISIBLE to product room', () => {
    const payload = {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие вопросы',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'User',
      authorAvatarUrl: null,
      body: 'Updated',
      productVariantId: null,
      variantLabel: null,
      status: ProductQaMessageStatus.VISIBLE,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: [],
      createdAt: '2026-08-09T10:00:00.000Z',
      editedAt: '2026-08-09T10:05:00.000Z',
    };

    gateway.broadcastMessageUpdated('p1', payload);

    expect(to).toHaveBeenCalledWith('productQa:p1');
    expect(emit).toHaveBeenCalledWith(PRODUCT_QA_WS_MESSAGE_UPDATED, payload);
  });

  it('broadcastMessageUpdated emits PENDING to staff room only', () => {
    const payload = {
      id: 'm2',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие вопросы',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'User',
      authorAvatarUrl: null,
      body: 'Pending edit',
      productVariantId: null,
      variantLabel: null,
      status: ProductQaMessageStatus.PENDING,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: [],
      createdAt: '2026-08-09T10:00:00.000Z',
      editedAt: '2026-08-09T10:05:00.000Z',
    };

    gateway.broadcastMessageUpdated('p1', payload);

    expect(to).toHaveBeenCalledWith(ROOM_STAFF_PRODUCT_QA);
    expect(emit).toHaveBeenCalledWith(PRODUCT_QA_WS_STAFF_QA_MESSAGE_UPDATED, {
      productId: 'p1',
      message: payload,
    });
    expect(to).not.toHaveBeenCalledWith('productQa:p1');
  });

  it('broadcastMessageCreated emits non-VISIBLE to staff room only', () => {
    const payload = {
      id: 'm3',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие вопросы',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'User',
      authorAvatarUrl: null,
      body: 'Hidden?',
      productVariantId: null,
      variantLabel: null,
      status: ProductQaMessageStatus.HIDDEN,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: [],
      createdAt: '2026-08-09T10:00:00.000Z',
      editedAt: null,
    };

    gateway.broadcastMessageCreated('p1', payload);

    expect(to).toHaveBeenCalledWith(ROOM_STAFF_PRODUCT_QA);
    expect(emit).toHaveBeenCalledWith(PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED, {
      productId: 'p1',
      message: payload,
    });
    expect(to).not.toHaveBeenCalledWith('productQa:p1');
  });

  it('broadcastStaffNewQuestion emits to staff room', () => {
    const payload = {
      productId: 'p1',
      productSlug: 'chair',
      productName: 'Стул',
      messageId: 'm1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      preview: 'Размер?',
    };
    gateway.broadcastStaffNewQuestion(payload);
    expect(to).toHaveBeenCalledWith(ROOM_STAFF_PRODUCT_QA);
    expect(emit).toHaveBeenCalledWith(PRODUCT_QA_WS_STAFF_NEW_QUESTION, payload);
  });
});
