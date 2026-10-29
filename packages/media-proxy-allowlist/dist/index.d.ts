/** Базовые CDN/object-storage суффиксы + MEDIA_PROXY_ALLOWED_HOST_SUFFIXES (comma-separated). */
export declare const DEFAULT_ALLOWED_HOST_SUFFIXES: readonly [".amazonaws.com", ".cloudfront.net", ".s3.amazonaws.com", ".storage.yandexcloud.net", ".selcdn.ru", ".cdn.digitaloceanspaces.com", ".digitaloceanspaces.com", ".b-cdn.net", ".googleusercontent.com", ".ggpht.com", ".imgix.net", ".cloudinary.com", ".mzstatic.com"];
export declare function parseAllowedHostSuffixesFromEnv(raw: string | undefined | null): string[];
export type MediaProxyAllowlistConfig = {
    /** Exact origins allowed (e.g. http://127.0.0.1:3001). */
    allowedOrigins: Iterable<string>;
    /** Host suffixes like `.amazonaws.com`; merged with defaults unless `includeDefaults: false`. */
    extraHostSuffixes?: Iterable<string>;
    includeDefaultHostSuffixes?: boolean;
};
export declare function isAllowedMediaProxyTarget(target: URL, cfg: MediaProxyAllowlistConfig): boolean;
/** Strip trailing /api/vN so origin is the API host. */
export declare function originFromApiBase(raw: string): string | null;
export declare function originFromPublicBase(raw: string): string | null;
/**
 * Resolve relative `/uploads/…` against API origin; absolute URLs as-is.
 */
export declare function resolveMediaProxyTargetUrl(raw: string, uploadsOrigin: string | null | undefined): URL | null;
export declare const MEDIA_PROXY_MAX_REDIRECTS = 5;
export declare class MediaProxyRedirectDeniedError extends Error {
    readonly url: URL;
    constructor(url: URL);
}
export declare class MediaProxyTooManyRedirectsError extends Error {
    constructor();
}
/**
 * fetch с redirect: 'manual' — каждый Location проверяется через allowlist
 * (иначе 302 на чужой host обходит SSRF-защиту).
 */
export declare function fetchMediaWithAllowedRedirects(start: URL, cfg: MediaProxyAllowlistConfig, init?: Omit<RequestInit, 'redirect'>, opts?: {
    maxRedirects?: number;
    fetchImpl?: typeof fetch;
}): Promise<Response>;
