/** Базовые CDN/object-storage суффиксы + MEDIA_PROXY_ALLOWED_HOST_SUFFIXES (comma-separated). */
export const DEFAULT_ALLOWED_HOST_SUFFIXES = [
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
] as const;

export function parseAllowedHostSuffixesFromEnv(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('.') ? s : `.${s}`));
}

export type MediaProxyAllowlistConfig = {
  /** Exact origins allowed (e.g. http://127.0.0.1:3001). */
  allowedOrigins: Iterable<string>;
  /** Host suffixes like `.amazonaws.com`; merged with defaults unless `includeDefaults: false`. */
  extraHostSuffixes?: Iterable<string>;
  includeDefaultHostSuffixes?: boolean;
};

function hostSuffixList(cfg: MediaProxyAllowlistConfig): string[] {
  const extras = Array.from(cfg.extraHostSuffixes ?? []).map((s) => {
    const t = s.trim().toLowerCase();
    return t.startsWith('.') ? t : `.${t}`;
  });
  if (cfg.includeDefaultHostSuffixes === false) return extras;
  return (Array.from(DEFAULT_ALLOWED_HOST_SUFFIXES) as string[]).concat(extras);
}

export function isAllowedMediaProxyTarget(target: URL, cfg: MediaProxyAllowlistConfig): boolean {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  const origins = new Set(
    Array.from(cfg.allowedOrigins)
      .map((o) => o.replace(/\/+$/, ''))
      .filter(Boolean),
  );
  if (origins.has(target.origin)) return true;
  const host = target.hostname.toLowerCase();
  return hostSuffixList(cfg).some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/** Strip trailing /api/vN so origin is the API host. */
export function originFromApiBase(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    let base = t.replace(/\/+$/, '');
    if (!/\/api\/v\d+$/i.test(base) && /^https?:\/\/[^/]+$/i.test(base)) {
      base = `${base}/api/v1`;
    } else if (/\/api$/i.test(base)) {
      base = `${base}/v1`;
    } else if (!/^https?:\/\//i.test(base)) {
      return null;
    }
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function originFromPublicBase(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve relative `/uploads/…` against API origin; absolute URLs as-is.
 */
export function resolveMediaProxyTargetUrl(
  raw: string,
  uploadsOrigin: string | null | undefined,
): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('/uploads/')) {
      if (!uploadsOrigin?.trim()) return null;
      return new URL(trimmed, `${uploadsOrigin.replace(/\/+$/, '')}/`);
    }
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export const MEDIA_PROXY_MAX_REDIRECTS = 5;

export class MediaProxyRedirectDeniedError extends Error {
  readonly url: URL;
  constructor(url: URL) {
    super(`media-proxy redirect denied: ${url.hostname}`);
    this.name = 'MediaProxyRedirectDeniedError';
    this.url = url;
  }
}

export class MediaProxyTooManyRedirectsError extends Error {
  constructor() {
    super('media-proxy: too many redirects');
    this.name = 'MediaProxyTooManyRedirectsError';
  }
}

/**
 * fetch с redirect: 'manual' — каждый Location проверяется через allowlist
 * (иначе 302 на чужой host обходит SSRF-защиту).
 */
export async function fetchMediaWithAllowedRedirects(
  start: URL,
  cfg: MediaProxyAllowlistConfig,
  init?: Omit<RequestInit, 'redirect'>,
  opts?: { maxRedirects?: number; fetchImpl?: typeof fetch },
): Promise<Response> {
  const maxRedirects = opts?.maxRedirects ?? MEDIA_PROXY_MAX_REDIRECTS;
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
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        throw new MediaProxyRedirectDeniedError(current);
      }
      current = next;
      continue;
    }
    return res;
  }
  throw new MediaProxyTooManyRedirectsError();
}
