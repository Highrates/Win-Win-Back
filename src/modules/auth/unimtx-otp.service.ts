import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function formatNetworkError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts: string[] = [e.message];
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) parts.push(cause.message);
  else if (typeof cause === 'string' && cause.trim()) parts.push(cause.trim());
  return parts.join(' — ');
}

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

  private requestTimeoutMs(): number {
    const raw = this.config.get<string>('UNIMTX_REQUEST_TIMEOUT_MS')?.trim();
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n < 5_000) return 25_000;
    if (n > 120_000) return 120_000;
    return n;
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
    const endpoint = url.toString();
    const host = url.hostname;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs()),
      });
    } catch (e) {
      const detail = formatNetworkError(e);
      this.logger.warn(`Unimtx ${action}: сеть/host=${host}: ${detail}`);
      throw new Error(
        `Нет связи с API Unimtx (${host}). Проверьте интернет, VPN и файрвол. ` +
          `Иногда помогает другой региональный endpoint в backend/.env: ` +
          `UNIMTX_API_BASE_URL=https://api-eu.unimtx.com или https://api-sg.unimtx.com ` +
          `(см. документацию Unimtx «Regions & Endpoints»). ` +
          `Таймаут запроса: ${this.requestTimeoutMs()} мс (UNIMTX_REQUEST_TIMEOUT_MS). Детали: ${detail}`,
      );
    }
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
  async sendSmsOtp(toE164: string, code: string, ttlMinutes = 10): Promise<void> {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      throw new Error('OTP код должен быть 6 цифр');
    }

    // У Unimatrix в некоторых регионах сообщение должно соответствовать шаблону (см. код 107141).
    // Если задан UNIMTX_SMS_TEMPLATE_ID — используем его; иначе пытаемся отправить plain content.
    const templateId = this.config.get<string>('UNIMTX_SMS_TEMPLATE_ID')?.trim();
    const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? Math.round(ttlMinutes) : 10;
    const sig = this.signature();
    /**
     * С шаблоном отправитель уже задан в консоли Unimtx (привязка к шаблону).
     * Лишний `signature` в теле иногда даёт SmsSignatureNotExists (другой регион API / несовпадение строки).
     * Явно передать имя можно через UNIMTX_SMS_SIGNATURE_WITH_TEMPLATE=1.
     */
    const sigWithTplRaw = this.config.get<string>('UNIMTX_SMS_SIGNATURE_WITH_TEMPLATE')?.trim().toLowerCase();
    const withTemplateSig = sigWithTplRaw === '1' || sigWithTplRaw === 'true' || sigWithTplRaw === 'yes';

    const body: Record<string, unknown> = templateId
      ? {
          to: toE164,
          ...(withTemplateSig ? { signature: sig } : {}),
          templateId,
          templateData: { code: digits, ttl: String(ttl) },
        }
      : {
          to: toE164,
          signature: sig,
          content: `Код подтверждения Win-Win: ${digits}. Действует ${ttl} минут.`,
        };

    const { ok, payload, raw } = await this.postJson('sms.message.send', body);

    if (!ok) {
      this.logger.warn(
        `Unimtx sms.message.send failed: code=${payload.code} ${raw.slice(0, 500)}`,
      );
      const apiMsg = payload.message?.trim() || '';
      let hint = '';
      if (apiMsg.includes('SmsSignatureNotExists')) {
        hint =
          ' Проверьте, что UNIMTX_SMS_SIGNATURE в backend/.env совпадает с именем отправителя в Unimtx Console (регистр и дефисы). ' +
          'При отправке по шаблону поле signature в запросе по умолчанию не передаётся — не задавайте UNIMTX_SMS_SIGNATURE_WITH_TEMPLATE, если не нужно.';
      }
      const base =
        apiMsg ||
        `Unimtx sms.message.send: ${payload.code ?? 'error'} (см. Unimtx Console: Templates/Senders)`;
      throw new Error(base + hint);
    }

    const data = payload.data as { messages?: Array<{ id?: string }> } | undefined;
    const id = data?.messages?.[0]?.id;
    this.logger.log(`Unimtx sms.message.send принят: to=${toE164} id=${id ?? '—'}`);
  }
}
