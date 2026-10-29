import { ConfigService } from '@nestjs/config';
import {
  fetchMediaWithAllowedRedirects,
  isAllowedMediaProxyTarget,
  originFromApiBase,
  originFromPublicBase,
  parseAllowedHostSuffixesFromEnv,
  resolveMediaProxyTargetUrl,
  type MediaProxyAllowlistConfig,
} from '@win-win/media-proxy-allowlist';

function collectBackendAllowedOrigins(config: ConfigService): Set<string> {
  const out = new Set<string>();
  const candidates = [
    config.get<string>('API_URL'),
    config.get<string>('BACKEND_INTERNAL_URL'),
    config.get<string>('LOCAL_UPLOADS_PUBLIC_URL'),
    config.get<string>('S3_PUBLIC_BASE_URL'),
    config.get<string>('FRONTEND_PUBLIC_URL'),
  ];
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    const asApi = originFromApiBase(raw.trim());
    if (asApi) out.add(asApi);
    const asPublic = originFromPublicBase(raw.trim());
    if (asPublic) out.add(asPublic);
  }
  out.add('http://127.0.0.1:3001');
  out.add('http://localhost:3001');
  return out;
}

export function buildBackendMediaAllowlistConfig(config: ConfigService): MediaProxyAllowlistConfig {
  return {
    allowedOrigins: collectBackendAllowedOrigins(config),
    extraHostSuffixes: parseAllowedHostSuffixesFromEnv(
      config.get<string>('MEDIA_PROXY_ALLOWED_HOST_SUFFIXES'),
    ),
  };
}

function uploadsOrigin(config: ConfigService): string | null {
  return (
    originFromPublicBase(config.get<string>('LOCAL_UPLOADS_PUBLIC_URL') ?? '') ||
    originFromApiBase(config.get<string>('API_URL') ?? '') ||
    originFromApiBase(config.get<string>('BACKEND_INTERNAL_URL') ?? '') ||
    'http://127.0.0.1:3001'
  );
}

/**
 * Fetch image bytes only from allowlisted hosts (same policy as Next media-proxy).
 * Returns null on deny / error / empty body.
 */
export async function fetchAllowedMediaBuffer(
  config: ConfigService,
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<Buffer | null> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const maxBytes = opts?.maxBytes ?? 2_000_000;
  const cfg = buildBackendMediaAllowlistConfig(config);
  const target = resolveMediaProxyTargetUrl(url, uploadsOrigin(config));
  if (!target) return null;
  if (!isAllowedMediaProxyTarget(target, cfg)) return null;

  try {
    const res = await fetchMediaWithAllowedRedirects(target, cfg, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 32 || ab.byteLength > maxBytes) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}
