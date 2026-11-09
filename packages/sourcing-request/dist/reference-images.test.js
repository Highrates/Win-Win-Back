"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const reference_images_1 = require("./reference-images");
const bytes = (...b) => new Uint8Array(b);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
(0, vitest_1.describe)('detectSourcingReferenceImageMime', () => {
    (0, vitest_1.it)('распознаёт JPEG, PNG, GIF, WebP', () => {
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(ascii('GIF89a...'))).toBe('image/gif');
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    });
    (0, vitest_1.it)('не принимает PDF и HTML под видом картинки', () => {
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(ascii('%PDF-1.7'))).toBeNull();
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(ascii('<html><body>'))).toBeNull();
        (0, vitest_1.expect)((0, reference_images_1.detectSourcingReferenceImageMime)(bytes())).toBeNull();
    });
});
(0, vitest_1.describe)('isSourcingReferenceImageMime / isHeicLike', () => {
    (0, vitest_1.it)('разрешает только JPEG/PNG/WebP/GIF', () => {
        (0, vitest_1.expect)((0, reference_images_1.isSourcingReferenceImageMime)('image/png')).toBe(true);
        (0, vitest_1.expect)((0, reference_images_1.isSourcingReferenceImageMime)('image/avif')).toBe(false);
        (0, vitest_1.expect)((0, reference_images_1.isSourcingReferenceImageMime)('image/svg+xml')).toBe(false);
        (0, vitest_1.expect)((0, reference_images_1.isSourcingReferenceImageMime)('image/heic')).toBe(false);
    });
    (0, vitest_1.it)('узнаёт HEIC по MIME и расширению', () => {
        (0, vitest_1.expect)((0, reference_images_1.isHeicLike)('image/heic')).toBe(true);
        (0, vitest_1.expect)((0, reference_images_1.isHeicLike)('', 'IMG_0001.HEIC')).toBe(true);
        (0, vitest_1.expect)((0, reference_images_1.isHeicLike)('image/jpeg', 'photo.jpg')).toBe(false);
    });
});
