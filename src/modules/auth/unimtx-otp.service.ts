import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Отправка SMS через Unimatrix:
 * - {@link https://www.unimtx.com/docs/api/send SMS Messaging API} (action=sms.message.send)
 * - {@link https://www.unimtx.com/docs/api/general общие query-параметры} (Simple mode: accessKeyId)
 */
@Injectable()
export class UnimtxOtpService {
  private readonly logger = new Logger(UnimtxOtpService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return this.config.get<string>('UNIMTX_API_BASE_URL')?.trim() || 'https://api.unimtx.com';
  }

  private accessKeyId(): string {
    const v = this.config.get<string>('UNIMTX_ACCESS_KEY_ID')?.trim();
    if (!v) {
      throw new Error('UNIMTX_ACCESS_KEY_ID должен быть задан для отправки SMS OTP');
    }
    return v;
  }

  private signature(): string {
    const v = this.config.get<string>('UNIMTX_SMS_SIGNATURE')?.trim();
    if (!v) {
      throw new Error('UNIMTX_SMS_SIGNATURE должен быть задан (approved sender в Unimatrix Console)');
    }
    return v;
  }

  private async postJson(action: string, body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    payload: { code?: string; message?: string; data?: unknown };
    raw: string;
  }> {
    const url = new URL(this.baseUrl());
    url.searchParams.set('action', action);
    url.searchParams.set('accessKeyId', this.accessKeyId());

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let payload: { code?: string; message?: string; data?: unknown } = {};
    try {
      payload = raw.trim() ? (JSON.parse(raw) as typeof payload) : {};
    } catch {
      this.logger.warn(`Unimtx ${action}: ответ не JSON (HTTP ${res.status}): ${raw.slice(0, 400)}`);
      throw new Error(`Unimtx: некорректный ответ API (HTTP ${res.status})`);
    }
    const ok = res.ok && String(payload.code) === '0';
    return { ok, status: res.status, payload, raw };
  }

  /**
   * Отправка OTP по SMS с явным sender (signature).
   * Номер получателя — E.164, например +79031234567.
   */
  async sendSmsOtp(toE164: string, code: string): Promise<void> {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      throw new Error('OTP код должен быть 6 цифр');
    }

    // У Unimatrix в некоторых регионах сообщение должно соответствовать шаблону (см. код 107141).
    // Если задан UNIMTX_SMS_TEMPLATE_ID — используем его; иначе пытаемся отправить plain content.
    const templateId = this.config.get<string>('UNIMTX_SMS_TEMPLATE_ID')?.trim();
    const body: Record<string, unknown> = templateId
      ? {
          to: toE164,
          templateId,
          templateData: { code: digits, ttl: '10' },
        }
      : {
          to: toE164,
          signature: this.signature(),
          content: `Код подтверждения Win-Win: ${digits}`,
        };

    const { ok, payload, raw } = await this.postJson('sms.message.send', body);

    if (!ok) {
      this.logger.warn(
        `Unimtx sms.message.send failed: code=${payload.code} ${raw.slice(0, 500)}`,
      );
      throw new Error(
        payload.message ||
          `Unimtx sms.message.send: ${payload.code ?? 'error'} (см. Unimtx Console: Templates/Senders)`,
      );
    }

    const data = payload.data as { messages?: Array<{ id?: string }> } | undefined;
    const id = data?.messages?.[0]?.id;
    this.logger.log(`Unimtx sms.message.send принят: to=${toE164} id=${id ?? '—'}`);
  }
}
