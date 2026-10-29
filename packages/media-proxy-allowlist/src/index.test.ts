import { describe, expect, it, vi } from 'vitest';
import {
  fetchMediaWithAllowedRedirects,
  isAllowedMediaProxyTarget,
  MediaProxyRedirectDeniedError,
  parseAllowedHostSuffixesFromEnv,
} from './index';

const cfg = {
  allowedOrigins: ['http://127.0.0.1:3001', 'http://localhost:3001'],
  extraHostSuffixes: parseAllowedHostSuffixesFromEnv(undefined),
};

describe('media-proxy-allowlist', () => {
  it('allows known origins and CDN suffixes', () => {
    expect(isAllowedMediaProxyTarget(new URL('http://127.0.0.1:3001/uploads/a.jpg'), cfg)).toBe(
      true,
    );
    expect(
      isAllowedMediaProxyTarget(new URL('https://bucket.s3.eu-central-1.amazonaws.com/x.jpg'), cfg),
    ).toBe(true);
    expect(isAllowedMediaProxyTarget(new URL('https://evil.example/a.jpg'), cfg)).toBe(false);
  });

  it('denies redirect to foreign host', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
      });
    });
    await expect(
      fetchMediaWithAllowedRedirects(
        new URL('http://127.0.0.1:3001/uploads/a.jpg'),
        cfg,
        {},
        { fetchImpl: fetchImpl as never },
      ),
    ).rejects.toBeInstanceOf(MediaProxyRedirectDeniedError);
  });

  it('follows redirect to allowed host', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:3001/uploads/b.jpg' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchMediaWithAllowedRedirects(
      new URL('http://127.0.0.1:3001/uploads/a.jpg'),
      cfg,
      {},
      { fetchImpl: fetchImpl as never },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
