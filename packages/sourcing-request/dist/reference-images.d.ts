/** Форматы фото-референсов: то, что показывают все браузеры без конвертации. */
export declare const SOURCING_REFERENCE_IMAGE_MIME: readonly ["image/jpeg", "image/png", "image/webp", "image/gif"];
export type SourcingReferenceImageMime = (typeof SOURCING_REFERENCE_IMAGE_MIME)[number];
export declare const SOURCING_REFERENCE_ACCEPT: string;
export declare const SOURCING_REFERENCE_FORMATS_LABEL = "JPEG, PNG, WebP \u0438\u043B\u0438 GIF";
/** Длинная сторона фото после сжатия на клиенте. */
export declare const SOURCING_REFERENCE_MAX_EDGE_PX = 2560;
export declare const SOURCING_REFERENCE_JPEG_QUALITY = 0.85;
export declare function isSourcingReferenceImageMime(mime: string | null | undefined): mime is SourcingReferenceImageMime;
/** HEIC/HEIF: Safari декодирует (и мы конвертируем в JPEG), Chrome/Firefox — нет. */
export declare function isHeicLike(mime: string | null | undefined, name?: string | null): boolean;
/** MIME по сигнатуре файла (первые байты); null — не JPEG/PNG/WebP/GIF. */
export declare function detectSourcingReferenceImageMime(bytes: Uint8Array): SourcingReferenceImageMime | null;
