import { describe, expect, it } from 'vitest';
import { stripImageMetadata } from './strip-image-metadata';

function jpegWithApp1(): Buffer {
  // SOI + APP1 (fake EXIF) + SOS stub
  const app1Payload = Buffer.from('Exif\0\0GPSFAKE');
  const app1 = Buffer.alloc(4 + app1Payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(2 + app1Payload.length, 2);
  app1Payload.copy(app1, 4);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos]);
}

describe('stripImageMetadata', () => {
  it('removes JPEG APP1 (EXIF) segment', () => {
    const raw = jpegWithApp1();
    expect(raw.includes(Buffer.from('Exif'))).toBe(true);
    const stripped = stripImageMetadata(raw, 'image/jpeg');
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect(stripped.includes(Buffer.from('Exif'))).toBe(false);
    expect(stripped.includes(Buffer.from([0xff, 0xda]))).toBe(true);
  });

  it('leaves non-images unchanged', () => {
    const pdf = Buffer.from('%PDF-1.4');
    expect(stripImageMetadata(pdf, 'application/pdf')).toBe(pdf);
  });
});
