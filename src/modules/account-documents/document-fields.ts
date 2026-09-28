/**
 * Поля вложений для ленты «Документы», заполняются при загрузке.
 * Те же правила продублированы в SQL миграции 20260928180000_account_documents_columns (backfill).
 */

const MEDIA_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'svg', 'tif', 'tiff',
  'mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
] as const;
const MEDIA_EXT = new RegExp(`\\.(${MEDIA_EXTS.join('|')})$`, 'i');
const MEDIA_MIME = /^(image|video|audio)\//i;

/** Документ = не изображение / видео / аудио (по mime и расширению). */
export function isNonMediaDocument(mimeType: string | null | undefined, filename: string): boolean {
  if (MEDIA_MIME.test(mimeType?.trim() ?? '')) return false;
  return !MEDIA_EXT.test(filename.trim());
}

/** Нормализация для поиска: нижний регистр, ё → е. Применяется и к имени файла, и к запросу. */
export function foldSearch(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

export function documentSearchName(filename: string): string {
  return foldSearch(filename.trim());
}
