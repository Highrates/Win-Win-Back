import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

/**
 * Общая логика OTP: генерация, хеш, сверка, лимит попыток.
 * Таблицы challenge остаются у Registration / AccountContact.
 */
@Injectable()
export class OtpChallengeService {
  readonly ttlMs = OTP_TTL_MS;
  readonly maxAttempts = MAX_OTP_ATTEMPTS;

  generateOtpCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  expiresAt(fromMs = Date.now()): Date {
    return new Date(fromMs + this.ttlMs);
  }

  async hashOtp(code: string): Promise<string> {
    return bcrypt.hash(code, 8);
  }

  async otpMatches(code: string, codeHash: string): Promise<boolean> {
    return bcrypt.compare(code, codeHash);
  }

  async createOtp(): Promise<{ code: string; codeHash: string; expiresAt: Date }> {
    const code = this.generateOtpCode();
    const codeHash = await this.hashOtp(code);
    return { code, codeHash, expiresAt: this.expiresAt() };
  }

  /**
   * После неверного кода: атомарный increment attempts.
   * @param tryIncrement — updateMany с `attempts: { lt: max }` → { count }
   * @param purge — удалить challenge при исчерпании
   */
  async rejectWrongCode(opts: {
    tryIncrement: () => Promise<{ count: number }>;
    purge: () => Promise<unknown>;
  }): Promise<never> {
    const inc = await opts.tryIncrement();
    if (inc.count === 0) {
      await opts.purge().catch(() => undefined);
      throw new BadRequestException('Превышено число попыток. Запросите код заново.');
    }
    throw new BadRequestException('Неверный код');
  }
}
