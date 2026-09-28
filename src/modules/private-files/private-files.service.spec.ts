import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PrivateFilesService } from './private-files.service';

describe('PrivateFilesService', () => {
  const prisma = {
    chatAttachment: { findFirst: vi.fn() },
    sourcingRequestAttachment: { findFirst: vi.fn() },
    orderDocument: { findFirst: vi.fn() },
  };
  const storage = {
    tryPublicUrlToKey: vi.fn((url: string) =>
      url.startsWith('https://s3/') ? url.slice('https://s3/'.length) : null,
    ),
    openObjectStream: vi.fn(),
  };
  const staffAccess = { canAccessOrdersSection: vi.fn() };
  const customer = { userId: 'u1', role: 'USER' };

  let service: PrivateFilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    staffAccess.canAccessOrdersSection.mockResolvedValue(true);
    service = new PrivateFilesService(prisma as never, storage as never, staffAccess as never);
  });

  it('streams an owned chat file; pdf opens inline', async () => {
    prisma.chatAttachment.findFirst.mockResolvedValue({
      fileUrl: 'https://s3/objects/chat/orders/o1/abc.pdf',
      filename: 'КП.pdf',
      mimeType: 'application/pdf',
    });
    storage.openObjectStream.mockResolvedValue({ body: Readable.from(['x']), contentType: null, contentLength: 1 });

    const file = await service.open(customer, 'chat:a1');

    const where = JSON.stringify(prisma.chatAttachment.findFirst.mock.calls[0][0].where);
    expect(where).toContain('"userId":"u1"');
    expect(where).toContain('"deletedAt":null');
    expect(where).toContain('retentionPurgesAt');
    expect(storage.openObjectStream).toHaveBeenCalledWith('objects/chat/orders/o1/abc.pdf');
    expect(file).toMatchObject({ kind: 'stream', filename: 'КП.pdf', contentType: 'application/pdf', inline: true });
    expect(staffAccess.canAccessOrdersSection).not.toHaveBeenCalled();
  });

  it('chat images open inline, office files download', async () => {
    storage.openObjectStream.mockResolvedValue({ body: Readable.from(['x']), contentType: null, contentLength: null });
    prisma.chatAttachment.findFirst.mockResolvedValueOnce({
      fileUrl: 'https://s3/objects/chat/orders/o1/p.png',
      filename: 'photo.png',
      mimeType: 'image/png',
    });
    expect(await service.open(customer, 'chat:img')).toMatchObject({ inline: true, contentType: 'image/png' });

    prisma.sourcingRequestAttachment.findFirst.mockResolvedValue({
      url: 'https://s3/objects/sourcing-requests/s1/attachments/f.docx',
      filename: 'tz.docx',
      mimeType: null,
    });
    expect(await service.open(customer, 'sourcing:r1')).toMatchObject({
      kind: 'stream',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      inline: false,
    });
  });

  it('staff with orders access opens any file without the owner filter', async () => {
    prisma.sourcingRequestAttachment.findFirst.mockResolvedValue({
      url: 'https://s3/objects/sourcing-requests/s1/attachments/f.pdf',
      filename: 'f.pdf',
      mimeType: 'application/pdf',
    });
    storage.openObjectStream.mockResolvedValue({ body: Readable.from(['x']), contentType: null, contentLength: null });

    await service.open({ userId: 'staff1', role: 'MODERATOR' }, 'sourcing:r1');

    expect(staffAccess.canAccessOrdersSection).toHaveBeenCalledWith('staff1', 'MODERATOR');
    expect(prisma.sourcingRequestAttachment.findFirst.mock.calls[0][0].where).toEqual({ id: 'r1' });
  });

  it('staff without orders access is treated as a customer', async () => {
    staffAccess.canAccessOrdersSection.mockResolvedValue(false);
    prisma.orderDocument.findFirst.mockResolvedValue(null);

    await expect(service.open({ userId: 'staff2', role: 'MODERATOR' }, 'order-doc:d1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(JSON.stringify(prisma.orderDocument.findFirst.mock.calls[0][0].where)).toContain('"userId":"staff2"');
  });

  it('names order documents by kind and redirects for external URLs', async () => {
    prisma.orderDocument.findFirst.mockResolvedValue({ kind: 'invoice', url: 'https://bank.example/inv-1.pdf' });

    const file = await service.open(customer, 'order-doc:d1');

    expect(file).toEqual({ kind: 'redirect', url: 'https://bank.example/inv-1.pdf' });
    expect(storage.openObjectStream).not.toHaveBeenCalled();
  });

  it('returns 404 for foreign, unknown, malformed ids and missing objects', async () => {
    prisma.chatAttachment.findFirst.mockResolvedValue(null);
    await expect(service.open({ userId: 'u2', role: 'USER' }, 'chat:a1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.open(customer, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.open(customer, 'other:1')).rejects.toBeInstanceOf(NotFoundException);

    prisma.chatAttachment.findFirst.mockResolvedValue({
      fileUrl: 'https://s3/objects/chat/orders/o1/gone.pdf',
      filename: 'gone.pdf',
      mimeType: 'application/pdf',
    });
    storage.openObjectStream.mockResolvedValue(null);
    await expect(service.open(customer, 'chat:a1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
