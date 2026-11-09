/** Форматы фото-референсов: то, что показывают все браузеры без конвертации. */
export const SOURCING_REFERENCE_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type SourcingReferenceImageMime = (typeof SOURCING_REFERENCE_IMAGE_MIME)[number];

export const SOURCING_REFERENCE_ACCEPT = SOURCING_REFERENCE_IMAGE_MIME.join(',');

export const SOURCING_REFERENCE_FORMATS_LABEL = 'JPEG, PNG, WebP или GIF';

/** Длинная сторона фото после сжатия на клиенте. */
export const SOURCING_REFERENCE_MAX_EDGE_PX = 2560;
export const SOURCING_REFERENCE_JPEG_QUALITY = 0.85;

export function isSourcingReferenceImageMime(mime: string | null | undefined): mime is SourcingReferenceImageMime {
  return (SOURCING_REFERENCE_IMAGE_MIME as readonly string[]).includes((mime ?? '').trim().toLowerCase());
}

/** HEIC/HEIF: Safari декодирует (и мы конвертируем в JPEG), Chrome/Firefox — нет. */
export function isHeicLike(mime: string | null | undefined, name?: string | null): boolean {
  const m = (mime ?? '').trim().toLowerCase();
  if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') {
    return true;
  }
  return /\.(heic|heif)$/i.test(name ?? '');
}

/** MIME по сигнатуре файла (первые байты); null — не JPEG/PNG/WebP/GIF. */
export function detectSourcingReferenceImageMime(bytes: Uint8Array): SourcingReferenceImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.slice(0, 6));
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return null;
}
