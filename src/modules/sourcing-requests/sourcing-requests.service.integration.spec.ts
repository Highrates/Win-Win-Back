import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcingRequestsService } from './sourcing-requests.service';

function multerFile(fieldname: string, name = 'photo.jpg'): Express.Multer.File {
  return {
    fieldname,
    originalname: name,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 128,
    buffer: Buffer.from('jpeg'),
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

describe('SourcingRequestsService integration', () => {
  let service: SourcingRequestsService;
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    sourcingRequest: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    sourcingRequestItemImage: { create: ReturnType<typeof vi.fn> };
    sourcingRequestAttachment: { create: ReturnType<typeof vi.fn> };
  };
  let storage: { uploadBuffer: ReturnType<typeof vi.fn>; removeObjectKey: ReturnType<typeof vi.fn> };
  let orderChat: {
    ensureSourcingConversation: ReturnType<typeof vi.fn>;
    unreadStaffCountsForCustomerSourcingRequests: ReturnType<typeof vi.fn>;
  };
  let audit: { log: ReturnType<typeof vi.fn> };
  let mail: { sendSourcingSubmittedStaff: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<void>) => fn(prisma)),
      sourcingRequest: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(),
        findUnique: vi.fn(async () => ({ id: 'req1', title: 'Подбор дивана' })),
      },
      sourcingRequestItemImage: { create: vi.fn(async () => ({})) },
      sourcingRequestAttachment: { create: vi.fn(async () => ({})) },
    };
    storage = {
      assertLibraryFile: vi.fn(),
      libraryFileExtension: vi.fn(() => '.jpg'),
      uploadMediaLibraryObject: vi.fn(async () => ({
        url: 'https://cdn.test/file.jpg',
      })),
      uploadBuffer: vi.fn(async () => ({
        objectKey: 'objects/chat/test',
        url: 'https://cdn.test/file.jpg',
      })),
      removeObjectKey: vi.fn(async () => undefined),
    };
    orderChat = {
      ensureSourcingConversation: vi.fn(async () => undefined),
      unreadStaffCountsForCustomerSourcingRequests: vi.fn(async () => ({})),
      getStaffNotifyEmailRecipients: vi.fn(async () => ['manager@test.com']),
    };
    audit = { log: vi.fn(async () => undefined) };
    mail = { sendSourcingSubmittedStaff: vi.fn(async () => undefined) };
    config = { get: vi.fn(() => undefined) };

    service = new SourcingRequestsService(
      prisma as never,
      storage as never,
      orderChat as never,
      audit as never,
      mail as never,
      config as never,
    );
  });

  it('POST multipart: создаёт заявку при валидном payload и файлах', async () => {
    const refKey = 'ref-1';
    const payload = JSON.stringify({
      title: 'Подбор дивана',
      products: [{ name: 'Диван', quantity: 1, unit: 'шт', referenceImageKeys: [refKey] }],
    });
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

    await service.createForUser('user-a', payload, [multerFile(refKey)]);

    expect(storage.uploadMediaLibraryObject).toHaveBeenCalled();
    expect(prisma.sourcingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-a',
          title: 'Подбор дивана',
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

  it('GET :id owner isolation — чужая заявка недоступна', async () => {
    prisma.sourcingRequest.findFirst.mockResolvedValue(null);

    const row = await service.findOneDetailForUser('user-b', 'foreign-id');
    expect(row).toBeNull();

    expect(prisma.sourcingRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign-id', userId: 'user-b' },
      }),
    );
  });

  it('GET :id owner isolation — своя заявка возвращается', async () => {
    prisma.sourcingRequest.findFirst.mockResolvedValue({
      id: 'mine',
      userId: 'user-a',
      title: 'Моя',
      deliveryCity: null,
      status: 'IN_PROGRESS',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      items: [],
      attachments: [],
    });
    orderChat.unreadStaffCountsForCustomerSourcingRequests.mockResolvedValue({ mine: 2 });

    const row = await service.findOneDetailForUser('user-a', 'mine');
    expect(row).toMatchObject({ id: 'mine', title: 'Моя', unreadStaffChatCount: 2 });
  });

  it('POST multipart: отклоняет отсутствующий файл из payload', async () => {
    const payload = JSON.stringify({
      title: 'Заявка',
      products: [{ name: 'Стул', referenceImageKeys: ['missing-key'] }],
    });

    await expect(service.createForUser('user-a', payload, [])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sourcingRequest.create).not.toHaveBeenCalled();
  });
});
