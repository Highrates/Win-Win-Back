"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCING_REFERENCE_JPEG_QUALITY = exports.SOURCING_REFERENCE_MAX_EDGE_PX = exports.SOURCING_REFERENCE_FORMATS_LABEL = exports.SOURCING_REFERENCE_ACCEPT = exports.SOURCING_REFERENCE_IMAGE_MIME = void 0;
exports.isSourcingReferenceImageMime = isSourcingReferenceImageMime;
exports.isHeicLike = isHeicLike;
exports.detectSourcingReferenceImageMime = detectSourcingReferenceImageMime;
/** Форматы фото-референсов: то, что показывают все браузеры без конвертации. */
exports.SOURCING_REFERENCE_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
exports.SOURCING_REFERENCE_ACCEPT = exports.SOURCING_REFERENCE_IMAGE_MIME.join(',');
exports.SOURCING_REFERENCE_FORMATS_LABEL = 'JPEG, PNG, WebP или GIF';
/** Длинная сторона фото после сжатия на клиенте. */
exports.SOURCING_REFERENCE_MAX_EDGE_PX = 2560;
exports.SOURCING_REFERENCE_JPEG_QUALITY = 0.85;
function isSourcingReferenceImageMime(mime) {
    return exports.SOURCING_REFERENCE_IMAGE_MIME.includes((mime ?? '').trim().toLowerCase());
}
/** HEIC/HEIF: Safari декодирует (и мы конвертируем в JPEG), Chrome/Firefox — нет. */
function isHeicLike(mime, name) {
    const m = (mime ?? '').trim().toLowerCase();
    if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') {
        return true;
    }
    return /\.(heic|heif)$/i.test(name ?? '');
}
/** MIME по сигнатуре файла (первые байты); null — не JPEG/PNG/WebP/GIF. */
function detectSourcingReferenceImageMime(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a) {
        return 'image/png';
    }
    if (bytes.length >= 6) {
        const head = String.fromCharCode(...bytes.slice(0, 6));
        if (head === 'GIF87a' || head === 'GIF89a')
            return 'image/gif';
    }
    if (bytes.length >= 12) {
        const riff = String.fromCharCode(...bytes.slice(0, 4));
        const webp = String.fromCharCode(...bytes.slice(8, 12));
        if (riff === 'RIFF' && webp === 'WEBP')
            return 'image/webp';
    }
    return null;
}
