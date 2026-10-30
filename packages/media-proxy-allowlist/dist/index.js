"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaProxyTooManyRedirectsError = exports.MediaProxyRedirectDeniedError = exports.MEDIA_PROXY_MAX_REDIRECTS = exports.DEFAULT_ALLOWED_HOST_SUFFIXES = void 0;
exports.parseAllowedHostSuffixesFromEnv = parseAllowedHostSuffixesFromEnv;
exports.isAllowedMediaProxyTarget = isAllowedMediaProxyTarget;
exports.originFromApiBase = originFromApiBase;
exports.originFromPublicBase = originFromPublicBase;
exports.resolveMediaProxyTargetUrl = resolveMediaProxyTargetUrl;
exports.fetchMediaWithAllowedRedirects = fetchMediaWithAllowedRedirects;
/** Базовые CDN/object-storage суффиксы + MEDIA_PROXY_ALLOWED_HOST_SUFFIXES (comma-separated). */
exports.DEFAULT_ALLOWED_HOST_SUFFIXES = [
    '.amazonaws.com',
    '.cloudfront.net',
    '.s3.amazonaws.com',
    '.storage.yandexcloud.net',
    '.selcdn.ru',
    '.cdn.digitaloceanspaces.com',
    '.digitaloceanspaces.com',
    '.b-cdn.net',
    '.googleusercontent.com',
    '.ggpht.com',
    '.imgix.net',
    '.cloudinary.com',
    '.mzstatic.com',
];
function parseAllowedHostSuffixesFromEnv(raw) {
    return (raw ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((s) => (s.startsWith('.') ? s : `.${s}`));
}
function hostSuffixList(cfg) {
    const extras = Array.from(cfg.extraHostSuffixes ?? []).map((s) => {
        const t = s.trim().toLowerCase();
        return t.startsWith('.') ? t : `.${t}`;
    });
    if (cfg.includeDefaultHostSuffixes === false)
        return extras;
    return Array.from(exports.DEFAULT_ALLOWED_HOST_SUFFIXES).concat(extras);
}
function isAllowedMediaProxyTarget(target, cfg) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:')
        return false;
    const origins = new Set(Array.from(cfg.allowedOrigins)
        .map((o) => o.replace(/\/+$/, ''))
        .filter(Boolean));
    if (origins.has(target.origin))
        return true;
    const host = target.hostname.toLowerCase();
    return hostSuffixList(cfg).some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}
/** Strip trailing /api/vN so origin is the API host. */
function originFromApiBase(raw) {
    const t = raw.trim();
    if (!t)
        return null;
    try {
        let base = t.replace(/\/+$/, '');
        if (!/\/api\/v\d+$/i.test(base) && /^https?:\/\/[^/]+$/i.test(base)) {
            base = `${base}/api/v1`;
        }
        else if (/\/api$/i.test(base)) {
            base = `${base}/v1`;
        }
        else if (!/^https?:\/\//i.test(base)) {
            return null;
        }
        return new URL(base).origin;
    }
    catch {
        return null;
    }
}
function originFromPublicBase(raw) {
    const t = raw.trim();
    if (!t)
        return null;
    try {
        const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
        return new URL(withScheme).origin;
    }
    catch {
        return null;
    }
}
/**
 * Resolve relative `/uploads/…` against API origin; absolute URLs as-is.
 */
function resolveMediaProxyTargetUrl(raw, uploadsOrigin) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        if (trimmed.startsWith('/uploads/')) {
            if (!uploadsOrigin?.trim())
                return null;
            return new URL(trimmed, `${uploadsOrigin.replace(/\/+$/, '')}/`);
        }
        return new URL(trimmed);
    }
    catch {
        return null;
    }
}
exports.MEDIA_PROXY_MAX_REDIRECTS = 5;
class MediaProxyRedirectDeniedError extends Error {
    constructor(url) {
        super(`media-proxy redirect denied: ${url.hostname}`);
        this.name = 'MediaProxyRedirectDeniedError';
        this.url = url;
    }
}
exports.MediaProxyRedirectDeniedError = MediaProxyRedirectDeniedError;
class MediaProxyTooManyRedirectsError extends Error {
    constructor() {
        super('media-proxy: too many redirects');
        this.name = 'MediaProxyTooManyRedirectsError';
    }
}
exports.MediaProxyTooManyRedirectsError = MediaProxyTooManyRedirectsError;
/**
 * fetch с redirect: 'manual' — каждый Location проверяется через allowlist
 * (иначе 302 на чужой host обходит SSRF-защиту).
 */
async function fetchMediaWithAllowedRedirects(start, cfg, init, opts) {
    const maxRedirects = opts?.maxRedirects ?? exports.MEDIA_PROXY_MAX_REDIRECTS;
    const doFetch = opts?.fetchImpl ?? fetch;
    let current = start;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!isAllowedMediaProxyTarget(current, cfg)) {
            throw new MediaProxyRedirectDeniedError(current);
        }
        const res = await doFetch(current.toString(), {
            ...init,
            redirect: 'manual',
        });
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc?.trim()) {
                return res;
            }
            let next;
            try {
                next = new URL(loc, current);
            }
            catch {
                throw new MediaProxyRedirectDeniedError(current);
            }
            current = next;
            continue;
        }
        return res;
    }
    throw new MediaProxyTooManyRedirectsError();
}
