import { describe, expect, it } from 'vitest';
import {
  detectSourcingReferenceImageMime,
  isHeicLike,
  isSourcingReferenceImageMime,
} from './reference-images';

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('detectSourcingReferenceImageMime', () => {
  it('распознаёт JPEG, PNG, GIF, WebP', () => {
    expect(detectSourcingReferenceImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectSourcingReferenceImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(detectSourcingReferenceImageMime(ascii('GIF89a...'))).toBe('image/gif');
    expect(detectSourcingReferenceImageMime(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('не принимает PDF и HTML под видом картинки', () => {
    expect(detectSourcingReferenceImageMime(ascii('%PDF-1.7'))).toBeNull();
    expect(detectSourcingReferenceImageMime(ascii('<html><body>'))).toBeNull();
    expect(detectSourcingReferenceImageMime(bytes())).toBeNull();
  });
});

describe('isSourcingReferenceImageMime / isHeicLike', () => {
  it('разрешает только JPEG/PNG/WebP/GIF', () => {
    expect(isSourcingReferenceImageMime('image/png')).toBe(true);
    expect(isSourcingReferenceImageMime('image/avif')).toBe(false);
    expect(isSourcingReferenceImageMime('image/svg+xml')).toBe(false);
    expect(isSourcingReferenceImageMime('image/heic')).toBe(false);
  });

  it('узнаёт HEIC по MIME и расширению', () => {
    expect(isHeicLike('image/heic')).toBe(true);
    expect(isHeicLike('', 'IMG_0001.HEIC')).toBe(true);
    expect(isHeicLike('image/jpeg', 'photo.jpg')).toBe(false);
  });
});
