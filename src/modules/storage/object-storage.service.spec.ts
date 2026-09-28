import { Readable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ObjectStorageService } from './object-storage.service';

function makeService() {
  const env: Record<string, string> = {
    S3_BUCKET: 'pub',
    S3_PRIVATE_BUCKET: 'priv',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    S3_PUBLIC_BASE_URL: 'https://cdn.test/pub',
  };
  return new ObjectStorageService({ get: (k: string) => env[k] } as never);
}

describe('ObjectStorageService private bucket', () => {
  afterEach(() => vi.restoreAllMocks());

  it('puts chat attachments into the private bucket and public media into the public one', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const storage = makeService();
    const buf = Buffer.from('%PDF');

    const chat = await storage.uploadMediaLibraryObject(buf, 'application/pdf', 'objects/chat/orders/o1/a.pdf', 'a.pdf');
    await storage.uploadMediaLibraryObject(buf, 'application/pdf', 'objects/library/a.pdf', 'a.pdf');

    const buckets = send.mock.calls.map(([cmd]) => (cmd as PutObjectCommand).input.Bucket);
    expect(buckets).toEqual(['priv', 'pub']);
    expect(storage.tryPublicUrlToKey(chat.url)).toBe('objects/chat/orders/o1/a.pdf');
  });

  it('reads not-yet-migrated private objects from the public bucket', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }))
      .mockResolvedValueOnce({ Body: Readable.from(['x']), ContentType: 'application/pdf', ContentLength: 1 } as never);
    const storage = makeService();

    const obj = await storage.openObjectStream('objects/chat/orders/o1/a.pdf');

    expect(obj?.contentLength).toBe(1);
    expect(send.mock.calls.map(([cmd]) => (cmd as GetObjectCommand).input.Bucket)).toEqual(['priv', 'pub']);
  });
});
