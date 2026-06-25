"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProductMinimallyFilled = isProductMinimallyFilled;
exports.isSoftValidProductLink = isSoftValidProductLink;
function isProductMinimallyFilled(input) {
    return Boolean(input.name?.trim() ||
        input.description?.trim() ||
        input.productLink?.trim() ||
        (input.referenceCount ?? 0) > 0);
}
function isSoftValidProductLink(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return true;
    try {
        const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const url = new URL(normalized);
        return url.hostname.length > 0 && url.hostname.includes('.');
    }
    catch {
        return false;
    }
}
