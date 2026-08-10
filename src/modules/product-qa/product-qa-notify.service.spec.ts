import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaAuthorRole } from '@prisma/client';
import { ProductQaNotifyService } from './product-qa-notify.service';

describe('ProductQaNotifyService', () => {
  const mail = {
    sendProductQaNewQuestionStaff: vi.fn(async () => undefined),
    sendProductQaStaffReplyCustomer: vi.fn(async () => undefined),
  };
  const orderChat = { getStaffNotifyEmailRecipients: vi.fn(async () => ['staff@test.com']) };
  const gateway = { broadcastStaffNewQuestion: vi.fn() };
  const prisma = {
    product: {
      findUnique: vi.fn(async () => ({
        slug: 'chair',
        name: 'Стул Oak',
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        email: 'buyer@test.com',
        profile: { firstName: 'Ann' },
      })),
    },
  };
  const config = {
    get: vi.fn((key: string) => (key === 'FRONTEND_PUBLIC_URL' ? 'https://shop.test' : undefined)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    orderChat.getStaffNotifyEmailRecipients.mockResolvedValue(['staff@test.com']);
    mail.sendProductQaNewQuestionStaff.mockResolvedValue(undefined);
  });

  it('loads product name (not displayName) for email title', async () => {
    const findUnique = vi.fn(async () => ({
      slug: 'oak-chair',
      name: 'Стул Oak',
    }));
    const service = new ProductQaNotifyService(
      { product: { findUnique } } as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    await service['notifyStaffNewUserQuestion']('p1', {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'Ann',
      authorAvatarUrl: null,
      body: 'Размер?',
      productVariantId: null,
      variantLabel: null,
      status: 'VISIBLE',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { slug: true, name: true },
    });
    expect(mail.sendProductQaNewQuestionStaff).toHaveBeenCalledWith(
      expect.objectContaining({ productTitle: 'Стул Oak' }),
    );
    expect(gateway.broadcastStaffNewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'p1',
        productName: 'Стул Oak',
        messageId: 'm1',
      }),
    );
  });

  it('sends email for USER question', async () => {
    const service = new ProductQaNotifyService(
      prisma as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    await service['notifyStaffNewUserQuestion']('p1', {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'Ann',
      authorAvatarUrl: null,
      body: 'Какой размер?',
      productVariantId: null,
      variantLabel: null,
      status: 'VISIBLE',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(mail.sendProductQaNewQuestionStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        productTitle: 'Стул Oak',
        authorLabel: 'Ann',
        bodyPreview: 'Какой размер?',
      }),
    );
  });

  it('broadcasts WS even when email recipients are empty', async () => {
    orderChat.getStaffNotifyEmailRecipients.mockResolvedValue([]);
    const service = new ProductQaNotifyService(
      prisma as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    await service['notifyStaffNewUserQuestion']('p1', {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'Ann',
      authorAvatarUrl: null,
      body: 'Q',
      productVariantId: null,
      variantLabel: null,
      status: 'PENDING',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(gateway.broadcastStaffNewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', messageId: 'm1' }),
    );
    expect(mail.sendProductQaNewQuestionStaff).not.toHaveBeenCalled();
  });

  it('broadcasts WS when email send fails', async () => {
    mail.sendProductQaNewQuestionStaff.mockRejectedValue(new Error('SMTP unavailable'));
    const service = new ProductQaNotifyService(
      prisma as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    await service['notifyStaffNewUserQuestion']('p1', {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      authorUserId: 'u1',
      authorRole: ProductQaAuthorRole.USER,
      authorLabel: 'Ann',
      authorAvatarUrl: null,
      body: 'Q',
      productVariantId: null,
      variantLabel: null,
      status: 'PENDING',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(gateway.broadcastStaffNewQuestion).toHaveBeenCalled();
    expect(mail.sendProductQaNewQuestionStaff).toHaveBeenCalled();
  });

  it('scheduleStaffNotifyForUserQuestion skips STAFF', () => {
    const service = new ProductQaNotifyService(
      prisma as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    service.scheduleStaffNotifyForUserQuestion('p1', {
      id: 'm1',
      threadId: 't1',
      topicSlug: 'general',
      topicTitle: 'Общие',
      authorUserId: 's1',
      authorRole: ProductQaAuthorRole.STAFF,
      authorLabel: 'Admin',
      authorAvatarUrl: null,
      body: 'Ответ',
      productVariantId: null,
      variantLabel: null,
      status: 'VISIBLE',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(mail.sendProductQaNewQuestionStaff).not.toHaveBeenCalled();
    expect(gateway.broadcastStaffNewQuestion).not.toHaveBeenCalled();
  });

  it('sends customer email for STAFF correspondence reply', async () => {
    const service = new ProductQaNotifyService(
      prisma as never,
      config as never,
      mail as never,
      orderChat as never,
      gateway as never,
    );
    await service['notifyCustomerCorrespondenceReply']('p1', 'u1', {
      id: 'm2',
      correspondenceId: 'c1',
      authorUserId: 'staff1',
      authorRole: ProductQaAuthorRole.STAFF,
      authorLabel: 'Магазин',
      authorAvatarUrl: null,
      body: 'Ответ по размеру',
      productVariantId: null,
      variantLabel: null,
      publishedQaMessageId: null,
      isPublishedToStorefront: false,
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    expect(mail.sendProductQaStaffReplyCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@test.com',
        productTitle: 'Стул Oak',
        bodyPreview: 'Ответ по размеру',
      }),
    );
  });
});
