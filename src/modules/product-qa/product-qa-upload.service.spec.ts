import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { ProductQaUploadService } from './product-qa-upload.service';

function buildUploadService() {
  const prisma = {
    productQaAttachment: { count: vi.fn().mockResolvedValue(0) },
    productQaPendingUpload: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
  };
  const core = {
    resolveActiveProductById: vi.fn().mockResolvedValue({ id: 'p1' }),
    assertStaffCatalogAccess: vi.fn(),
  };
  const storage = {
    assertLibraryFile: vi.fn(),
    libraryFileExtension: vi.fn(() => '.jpg'),
    uploadMediaLibraryObject: vi.fn().mockResolvedValue({
      url: 'https://cdn.test/objects/product-qa/p1/x.jpg',
    }),
    removeObjectKey: vi.fn(),
  };
  const config = { get: vi.fn(() => '0') };

  const service = new ProductQaUploadService(
    prisma as never,
    core as never,
    storage as never,
    config as never,
  );
  return { service, prisma, storage, core };
}

describe('ProductQaUploadService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assertUploadQuota counts pending uploads', async () => {
    const { service, prisma } = buildUploadService();
    prisma.productQaAttachment.count.mockResolvedValue(39);
    prisma.productQaPendingUpload.count.mockResolvedValue(1);

    const file = {
      size: 100,
      mimetype: 'image/jpeg',
      originalname: 'photo.jpg',
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    await expect(
      service.uploadAttachment('p1', 'u1', UserRole.USER, file),
    ).rejects.toThrow(/квота/);
  });

  it('uploadAttachment creates pending record', async () => {
    const { service, prisma } = buildUploadService();
    const file = {
      size: 100,
      mimetype: 'image/jpeg',
      originalname: 'photo.jpg',
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    await service.uploadAttachment('p1', 'u1', UserRole.USER, file);

    expect(prisma.productQaPendingUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p1',
          userId: 'u1',
          objectKey: expect.stringContaining('objects/product-qa/p1/'),
        }),
      }),
    );
  });

  it('sweepExpiredPendingUploads removes stale rows and S3 keys', async () => {
    const { service, prisma, storage } = buildUploadService();
    prisma.productQaPendingUpload.findMany.mockResolvedValue([
      { id: 'pu1', objectKey: 'objects/product-qa/p1/stale.jpg' },
      { id: 'pu2', objectKey: 'objects/product-qa/p1/old.pdf' },
    ]);
    prisma.productQaPendingUpload.delete.mockResolvedValue({});

    const result = await service.sweepExpiredPendingUploads();

    expect(result.deleted).toBe(2);
    expect(storage.removeObjectKey).toHaveBeenCalledTimes(2);
    expect(prisma.productQaPendingUpload.delete).toHaveBeenCalledTimes(2);
  });
});
