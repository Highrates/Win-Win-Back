import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { ObjectStorageService, StoredObjectStream } from './object-storage.service';

export type StoredFileResponse =
  | { kind: 'stream'; filename: string; contentType: string; inline: boolean; object: StoredObjectStream }
  | { kind: 'redirect'; url: string };

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Только эти типы открываются в браузере (inline); остальное — скачивание.
 * Без HTML/SVG: они исполнялись бы на нашем origin.
 */
const INLINE_SAFE_MIME = new Set([
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function fileExtension(name: string): string | null {
  const m = name.trim().match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : null;
}

export function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').pop() ?? '') || url;
  } catch {
    return url.split('/').pop() || url;
  }
}

/** Тип файла по данным из БД: сохранённый mime, иначе по расширению имени. */
export function storedFileMime(mimeType: string | null | undefined, filename: string): string | null {
  const stored = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (stored && stored !== 'application/octet-stream') return stored;
  return EXT_MIME[fileExtension(filename) ?? ''] ?? null;
}

/**
 * Откроется ли файл во вкладке (inline) или скачается (attachment).
 * Одна функция и для `Content-Disposition`, и для флага `inline` в API — чтобы UI не расходился с ответом.
 */
export function isInlineStoredFile(mimeType: string | null | undefined, filename: string): boolean {
  const mime = storedFileMime(mimeType, filename);
  return mime != null && INLINE_SAFE_MIME.has(mime);
}

export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Файл по ссылке из БД: объект нашего хранилища — поток, внешний адрес — редирект. */
export async function openStoredFile(
  storage: ObjectStorageService,
  ref: { url: string; filename: string; mimeType: string | null },
): Promise<StoredFileResponse> {
  const url = ref.url.trim();
  if (!url) throw new NotFoundException('Файл не найден');
  const key = storage.tryPublicUrlToKey(url);
  if (!key) return { kind: 'redirect', url };

  const object = await storage.openObjectStream(key);
  if (!object) throw new NotFoundException('Файл не найден в хранилище');

  const fromStorage = (object.contentType ?? '').split(';')[0].trim().toLowerCase();
  const contentType = storedFileMime(ref.mimeType, ref.filename) ?? (fromStorage || 'application/octet-stream');
  return {
    kind: 'stream',
    filename: ref.filename,
    contentType,
    inline: isInlineStoredFile(ref.mimeType, ref.filename),
    object,
  };
}

export function sendStoredFile(res: Response, file: StoredFileResponse): void {
  if (file.kind === 'redirect') {
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, file.url);
    return;
  }
  // Картинки чата показываются в ленте: короткий приватный кэш, чтобы не качать заново при каждом рендере.
  res.setHeader(
    'Cache-Control',
    file.inline && file.contentType.startsWith('image/') ? 'private, max-age=300' : 'private, no-store',
  );
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.filename, file.inline));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (file.object.contentLength != null) {
    res.setHeader('Content-Length', String(file.object.contentLength));
  }
  file.object.body.on('error', () => res.destroy());
  file.object.body.pipe(res);
}
