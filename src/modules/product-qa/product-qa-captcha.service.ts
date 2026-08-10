import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProductQaCaptchaService {
  private readonly log = new Logger(ProductQaCaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  isRequiredForUserPosts(): boolean {
    return Boolean(this.config.get<string>('PRODUCT_QA_TURNSTILE_SECRET_KEY')?.trim());
  }

  async assertValidUserToken(token: string | undefined | null): Promise<void> {
    if (!this.isRequiredForUserPosts()) return;
    const secret = this.config.get<string>('PRODUCT_QA_TURNSTILE_SECRET_KEY')?.trim();
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
