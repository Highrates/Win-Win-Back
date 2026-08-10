import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

function clientIpFromRequest(req: Record<string, unknown>): string {
  const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
  const xff = headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() || String(req.ip ?? 'unknown');
  }
  if (Array.isArray(xff) && xff[0]) {
    return String(xff[0]).split(',')[0]?.trim() || String(req.ip ?? 'unknown');
  }
  return String(req.ip ?? 'unknown');
}

/** Per-IP throttling за reverse-proxy / Next BFF (X-Forwarded-For). */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return clientIpFromRequest(req);
  }
}
