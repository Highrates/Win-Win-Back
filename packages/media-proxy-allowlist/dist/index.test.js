"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
const cfg = {
    allowedOrigins: ['http://127.0.0.1:3001', 'http://localhost:3001'],
    extraHostSuffixes: (0, index_1.parseAllowedHostSuffixesFromEnv)(undefined),
};
(0, vitest_1.describe)('media-proxy-allowlist', () => {
    (0, vitest_1.it)('allows known origins and CDN suffixes', () => {
        (0, vitest_1.expect)((0, index_1.isAllowedMediaProxyTarget)(new URL('http://127.0.0.1:3001/uploads/a.jpg'), cfg)).toBe(true);
        (0, vitest_1.expect)((0, index_1.isAllowedMediaProxyTarget)(new URL('https://bucket.s3.eu-central-1.amazonaws.com/x.jpg'), cfg)).toBe(true);
        (0, vitest_1.expect)((0, index_1.isAllowedMediaProxyTarget)(new URL('https://evil.example/a.jpg'), cfg)).toBe(false);
    });
    (0, vitest_1.it)('denies redirect to foreign host', async () => {
        const fetchImpl = vitest_1.vi.fn(async () => {
            return new Response(null, {
                status: 302,
                headers: { location: 'https://evil.example/steal' },
            });
        });
        await (0, vitest_1.expect)((0, index_1.fetchMediaWithAllowedRedirects)(new URL('http://127.0.0.1:3001/uploads/a.jpg'), cfg, {}, { fetchImpl: fetchImpl })).rejects.toBeInstanceOf(index_1.MediaProxyRedirectDeniedError);
    });
    (0, vitest_1.it)('follows redirect to allowed host', async () => {
        const fetchImpl = vitest_1.vi
            .fn()
            .mockResolvedValueOnce(new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:3001/uploads/b.jpg' },
        }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        const res = await (0, index_1.fetchMediaWithAllowedRedirects)(new URL('http://127.0.0.1:3001/uploads/a.jpg'), cfg, {}, { fetchImpl: fetchImpl });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
