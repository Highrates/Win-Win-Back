import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, SourcingRequestStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcingRequestsService } from './sourcing-requests.service';

function buildService() {
  const prisma = {
    $transaction: vi.fn(),
    sourcingRequest: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatConversation: { findMany: vi.fn(async () => []) },
    sourcingRequestItemImage: { create: vi.fn() },
    sourcingRequestAttachment: { create: vi.fn() },
  };
  const storage = {
    assertLibraryFile: vi.fn(),
    libraryFileExtension: vi.fn(() => '.jpg'),
    uploadMediaLibraryObject: vi.fn(),
    removeObjectKey: vi.fn(async () => undefined),
  };
  const orderChat = {
    ensureSourcingConversation: vi.fn(async () => undefined),
    unreadStaffCountsForCustomerSourcingRequests: vi.fn(async () => ({})),
    unreadCustomerCountsForStaffSourcingRequests: vi.fn(async () => ({})),
    onSourcingStatusChanged: vi.fn(async () => undefined),
    getStaffNotifyEmailRecipients: vi.fn(async () => ['manager@test.com']),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const mail = { sendSourcingSubmittedStaff: vi.fn(async () => undefined) };
  const config = { get: vi.fn(() => undefined) };

  const service = new SourcingRequestsService(
    prisma as never,
    storage as never,
    orderChat as never,
    audit as never,
    mail as never,
    config as never,
  );

  return { service, prisma, storage, orderChat, audit, mail, config };
}

describe('SourcingRequestsService.updateStatus', () => {
  it('same-status PATCH: 200 без audit и без onSourcingStatusChanged', async () => {
    const updatedAt = new Date('2026-06-01T12:00:00.000Z');
    const { service, prisma, audit, orderChat } = buildService();
    prisma.sourcingRequest.findUnique.mockResolvedValue({
      id: 'req1',
      status: SourcingRequestStatus.PENDING_REVIEW,
      updatedAt,
    });

    const out = await service.updateStatus(
      'req1',
      SourcingRequestStatus.PENDING_REVIEW,
      'staff-1',
    );

    expect(out).toEqual({
      id: 'req1',
      status: SourcingRequestStatus.PENDING_REVIEW,
      updatedAt: updatedAt.toISOString(),
    });
    expect(prisma.sourcingRequest.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(orderChat.onSourcingStatusChanged).not.toHaveBeenCalled();
  });

  it('валидный переход: update + audit + onSourcingStatusChanged', async () => {
    const { service, prisma, audit, orderChat } = buildService();
    prisma.sourcingRequest.findUnique.mockResolvedValue({
      id: 'req1',
      status: SourcingRequestStatus.PENDING_REVIEW,
      updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    });
    prisma.sourcingRequest.update.mockResolvedValue({
      id: 'req1',
      status: SourcingRequestStatus.IN_PROGRESS,
      updatedAt: new Date('2026-06-01T13:00:00.000Z'),
    });

    const out = await service.updateStatus(
      'req1',
      SourcingRequestStatus.IN_PROGRESS,
      'staff-1',
    );

    expect(out.status).toBe(SourcingRequestStatus.IN_PROGRESS);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entityType: 'SourcingRequest',
        entityId: 'req1',
        actorUserId: 'staff-1',
        metadata: expect.objectContaining({
          from: SourcingRequestStatus.PENDING_REVIEW,
          to: SourcingRequestStatus.IN_PROGRESS,
        }),
      }),
    );
    expect(orderChat.onSourcingStatusChanged).toHaveBeenCalledWith(
      'req1',
      SourcingRequestStatus.IN_PROGRESS,
    );
  });

  it('недопустимый переход FSM → BadRequestException', async () => {
    const { service, prisma, audit } = buildService();
    prisma.sourcingRequest.findUnique.mockResolvedValue({
      id: 'req1',
      status: SourcingRequestStatus.COMPLETED,
      updatedAt: new Date(),
    });

    await expect(
      service.updateStatus('req1', SourcingRequestStatus.IN_PROGRESS, 'staff-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('неизвестная заявка → NotFoundException', async () => {
    const { service, prisma } = buildService();
    prisma.sourcingRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.updateStatus('missing', SourcingRequestStatus.IN_PROGRESS, 'staff-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SourcingRequestsService pagination clamp', () => {
  it('findByUser: page/limit зажимаются в допустимый диапазон', async () => {
    const { service, prisma } = buildService();
    prisma.sourcingRequest.count.mockResolvedValue(0);
    prisma.sourcingRequest.findMany.mockResolvedValue([]);

    await service.findByUser('user-a', 0, 500);

    expect(prisma.sourcingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 100,
      }),
    );
  });

  it('findManyForAdmin: отрицательная page → 1', async () => {
    const { service, prisma } = buildService();
    prisma.sourcingRequest.count.mockResolvedValue(0);
    prisma.sourcingRequest.findMany.mockResolvedValue([]);

    const out = await service.findManyForAdmin(-3, 10);

    expect(out.page).toBe(1);
    expect(prisma.sourcingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
  });
});

describe('SourcingRequestsService.countPendingReviewForAdmin', () => {
  it('считает заявки в PENDING_REVIEW', async () => {
    const { service, prisma } = buildService();
    prisma.sourcingRequest.count.mockResolvedValue(4);

    await expect(service.countPendingReviewForAdmin()).resolves.toEqual({ total: 4 });
    expect(prisma.sourcingRequest.count).toHaveBeenCalledWith({
      where: { status: SourcingRequestStatus.PENDING_REVIEW },
    });
  });
});

describe('SourcingRequestsService.createForUser rollback', () => {
  function multerFile(fieldname: string): Express.Multer.File {
    return {
      fieldname,
      originalname: 'photo.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 128,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      destination: '',
      filename: '',
      path: '',
      stream: null as never,
    };
  }

  it('откатывает загруженные ключи S3 при падении транзакции', async () => {
    const { service, prisma, storage } = buildService();
    prisma.$transaction.mockRejectedValue(new Error('db down'));
    storage.uploadMediaLibraryObject.mockResolvedValue({
      url: 'https://cdn.test/file.jpg',
    });

    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });

    await expect(service.createForUser('user-a', payload, [multerFile(refKey)])).rejects.toThrow(
      'db down',
    );
    expect(storage.removeObjectKey).toHaveBeenCalled();
    expect(prisma.sourcingRequest.create).not.toHaveBeenCalled();
  });

  it('имя товара: один товар без name → title заявки', async () => {
    const { service, prisma, storage, orderChat, mail } = buildService();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) =>
      fn(prisma),
    );
    prisma.sourcingRequest.create.mockResolvedValue({});
    prisma.sourcingRequest.findUnique.mockResolvedValue({
      id: 'req1',
      title: 'Подбор дивана',
    });
    prisma.sourcingRequest.findFirst.mockResolvedValue({
      id: 'req1',
      userId: 'user-a',
      title: 'Подбор дивана',
      deliveryCity: null,
      status: 'PENDING_REVIEW',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      attachments: [],
    });
    storage.uploadMediaLibraryObject.mockResolvedValue({ url: 'https://cdn.test/file.jpg' });

    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Подбор дивана',
      products: [
        {
          name: '',
          description: 'Мягкий',
          quantity: 1,
          unit: 'шт',
          referenceImageKeys: [refKey],
        },
      ],
    });

    await service.createForUser('user-a', payload, [multerFile(refKey)]);

    expect(prisma.sourcingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                name: 'Подбор дивана',
              }),
            ],
          },
        }),
      }),
    );
    await vi.waitFor(() => {
      expect(orderChat.ensureSourcingConversation).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mail.sendSourcingSubmittedStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          recipients: ['manager@test.com'],
          requestTitle: 'Подбор дивана',
        }),
      );
    });
  });

  it('имя товара: несколько позиций без name → «Товар N»', async () => {
    const { service, prisma, storage } = buildService();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) =>
      fn(prisma),
    );
    prisma.sourcingRequest.create.mockResolvedValue({});
    prisma.sourcingRequest.findFirst.mockResolvedValue({
      id: 'req1',
      userId: 'user-a',
      title: 'Комплект',
      deliveryCity: null,
      status: 'PENDING_REVIEW',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      attachments: [],
    });
    storage.uploadMediaLibraryObject.mockResolvedValue({ url: 'https://cdn.test/file.jpg' });

    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Комплект',
      products: [
        {
          name: '',
          description: 'Стул',
          quantity: 1,
          unit: 'шт',
          referenceImageKeys: [refKey],
        },
        {
          name: '',
          description: 'Стол',
          quantity: 1,
          unit: 'шт',
        },
      ],
    });

    await service.createForUser('user-a', payload, [multerFile(refKey)]);

    expect(prisma.sourcingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({ name: 'Товар 1' }),
              expect.objectContaining({ name: 'Товар 2' }),
            ],
          },
        }),
      }),
    );
  });

  it('отклоняет отсутствующий attachment key', async () => {
    const { service, prisma } = buildService();
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул' }],
      attachmentKeys: ['missing-att'],
    });

    await expect(service.createForUser('user-a', payload, [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.sourcingRequest.create).not.toHaveBeenCalled();
  });

  it('референс не по сигнатуре изображения (PDF под image/jpeg) → 400 до загрузки в S3', async () => {
    const { service, prisma, storage } = buildService();
    const refKey = 'ref-1';
    const fake = { ...multerFile(refKey), buffer: Buffer.from('%PDF-1.7 fake') };
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });

    await expect(service.createForUser('user-a', payload, [fake])).rejects.toThrow(/не изображение/);
    expect(storage.uploadMediaLibraryObject).not.toHaveBeenCalled();
    expect(prisma.sourcingRequest.create).not.toHaveBeenCalled();
  });

  it('референс сохраняется с MIME по сигнатуре, а не со слов клиента', async () => {
    const { service, prisma, storage } = buildService();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) =>
      fn(prisma),
    );
    prisma.sourcingRequest.findFirst.mockResolvedValue(null);
    storage.uploadMediaLibraryObject.mockResolvedValue({ url: 'https://cdn.test/file.png' });
    const refKey = 'ref-1';
    const png = {
      ...multerFile(refKey),
      mimetype: 'image/jpeg',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    };
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });

    await service.createForUser('user-a', payload, [png]);

    expect(storage.uploadMediaLibraryObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      expect.any(String),
      'photo.jpg',
    );
    expect(prisma.sourcingRequestItemImage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mimeType: 'image/png' }) }),
    );
  });

  it('повтор с тем же clientRequestId возвращает уже созданную заявку без загрузок', async () => {
    const { service, prisma, storage } = buildService();
    prisma.sourcingRequest.findUnique.mockResolvedValue({ id: 'req-existing' });
    prisma.sourcingRequest.findFirst.mockResolvedValue({
      id: 'req-existing',
      userId: 'user-a',
      title: 'Заявка',
      deliveryCity: null,
      status: 'PENDING_REVIEW',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      attachments: [],
    });
    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Заявка',
      clientRequestId: 'c0ffee00-1111-2222-3333-444455556666',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });

    const out = await service.createForUser('user-a', payload, [multerFile(refKey)]);

    expect(out?.id).toBe('req-existing');
    expect(prisma.sourcingRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_clientRequestId: {
            userId: 'user-a',
            clientRequestId: 'c0ffee00-1111-2222-3333-444455556666',
          },
        },
      }),
    );
    expect(storage.uploadMediaLibraryObject).not.toHaveBeenCalled();
    expect(prisma.sourcingRequest.create).not.toHaveBeenCalled();
  });

  it('гонка повторов: P2002 на create → откат загрузок и ответ победившей заявкой', async () => {
    const { service, prisma, storage } = buildService();
    prisma.sourcingRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'req-winner' });
    prisma.sourcingRequest.findFirst.mockResolvedValue({
      id: 'req-winner',
      userId: 'user-a',
      title: 'Заявка',
      deliveryCity: null,
      status: 'PENDING_REVIEW',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
      attachments: [],
    });
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    storage.uploadMediaLibraryObject.mockResolvedValue({ url: 'https://cdn.test/file.jpg' });
    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Заявка',
      clientRequestId: 'c0ffee00-1111-2222-3333-444455556666',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });

    const out = await service.createForUser('user-a', payload, [multerFile(refKey)]);

    expect(out?.id).toBe('req-winner');
    expect(storage.removeObjectKey).toHaveBeenCalled();
  });

  it('грузит в S3 параллельно и сохраняет порядок фото', async () => {
    const { service, prisma, storage } = buildService();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) =>
      fn(prisma),
    );
    prisma.sourcingRequest.findFirst.mockResolvedValue(null);
    let inFlight = 0;
    let maxInFlight = 0;
    storage.uploadMediaLibraryObject.mockImplementation(
      async (_buf: Buffer, _mime: string, key: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { url: `https://cdn.test/${key}` };
      },
    );
    const keys = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул', quantity: 1, unit: 'шт', referenceImageKeys: keys }],
    });

    await service.createForUser('user-a', payload, keys.map((k) => multerFile(k)));

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    const sortOrders = prisma.sourcingRequestItemImage.create.mock.calls.map(
      (c: [{ data: { sortOrder: number } }]) => c[0].data.sortOrder,
    );
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
