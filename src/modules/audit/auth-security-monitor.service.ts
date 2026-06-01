import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '@prisma/client';

type SpikeAction =
  | typeof AuditAction.LOGIN_FAILED
  | typeof AuditAction.REGISTER_FAILED
  | typeof AuditAction.AUTH_RATE_LIMITED;

const DEFAULT_SPIKE_WINDOW_SEC = 60;
const DEFAULT_SPIKE_THRESHOLD_401 = 30;
const DEFAULT_SPIKE_THRESHOLD_429 = 15;

@Injectable()
export class AuthSecurityMonitorService {
  private readonly logger = new Logger(AuthSecurityMonitorService.name);
  /** Временные метки событий в скользящем окне (FIFO). */
  private readonly events: { action: SpikeAction; at: number }[] = [];

  constructor(private readonly config: ConfigService) {}

  record(action: SpikeAction): void {
    const now = Date.now();
    const windowMs = this.spikeWindowMs();
    const cutoff = now - windowMs;

    while (this.events.length > 0 && this.events[0].at < cutoff) {
      this.events.shift();
    }
    this.events.push({ action, at: now });

    const threshold =
      action === AuditAction.AUTH_RATE_LIMITED
        ? this.spikeThreshold429()
        : this.spikeThreshold401();
    const count = this.events.filter((e) => e.action === action && e.at >= cutoff).length;

    if (count >= threshold) {
      this.logger.error(
        `AUTH_SPIKE_ALERT action=${action} count=${count} windowSec=${Math.round(windowMs / 1000)} threshold=${threshold} — возможен брутфорс или массовый rate limit на auth`,
      );
    }
  }

  private spikeWindowMs(): number {
    const raw = this.config.get<string>('AUTH_SPIKE_WINDOW_SEC');
    const parsed = raw === undefined || raw === null ? NaN : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SPIKE_WINDOW_SEC * 1000;
    return parsed * 1000;
  }

  private spikeThreshold401(): number {
    return this.parsePositiveInt('AUTH_SPIKE_THRESHOLD_401', DEFAULT_SPIKE_THRESHOLD_401);
  }

  private spikeThreshold429(): number {
    return this.parsePositiveInt('AUTH_SPIKE_THRESHOLD_429', DEFAULT_SPIKE_THRESHOLD_429);
  }

  private parsePositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = raw === undefined || raw === null ? NaN : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }
}
