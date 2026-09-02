import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cloudflare Turnstile siteverify.
 * Secret: `TURNSTILE_SECRET_KEY` или legacy `PRODUCT_QA_TURNSTILE_SECRET_KEY`.
 * Если секрет не задан — проверка пропускается (dev / без captcha).
 */
@Injectable()
export class TurnstileCaptchaService {
  private readonly log = new Logger(TurnstileCaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    return (
      this.config.get<string>('TURNSTILE_SECRET_KEY')?.trim() ||
      this.config.get<string>('PRODUCT_QA_TURNSTILE_SECRET_KEY')?.trim() ||
      ''
    );
  }

  isRequired(): boolean {
    return Boolean(this.secretKey());
  }

  /** @deprecated alias — Product QA / correspondence */
  isRequiredForUserPosts(): boolean {
    return this.isRequired();
  }

  async assertValidUserToken(token: string | undefined | null): Promise<void> {
    if (!this.isRequired()) return;
    const secret = this.secretKey();
    if (!secret) return;

    const response = token?.trim();
    if (!response) {
      throw new BadRequestException('Подтвердите, что вы не робот');
    }

    const body = new URLSearchParams({
      secret,
      response,
    });

    let json: { success?: boolean; 'error-codes'?: string[] };
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    } catch (e) {
      this.log.warn(`Turnstile verify failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadRequestException('Не удалось проверить captcha');
    }

    if (!json.success) {
      throw new BadRequestException('Captcha не пройдена');
    }
  }
}
