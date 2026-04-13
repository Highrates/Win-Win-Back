import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Отправка SMS через МТС Exolve (SendSMS). */
@Injectable()
export class ExolveSmsService {
  private readonly logger = new Logger(ExolveSmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendText(destinationDigits: string, text: string): Promise<void> {
    const token = this.config.get<string>('EXOLVE_API_TOKEN')?.trim();
    const sender = this.config.get<string>('EXOLVE_SMS_SENDER')?.trim();
    const url =
      this.config.get<string>('EXOLVE_SMS_URL')?.trim() ||
      'https://api.exolve.ru/messaging/v1/SendSMS';
    if (!token || !sender) {
      throw new Error('EXOLVE_API_TOKEN и EXOLVE_SMS_SENDER должны быть заданы для SMS');
    }

    // Формат тела — см. https://docs.exolve.ru/docs/ru/instructions/sending-sms/ (поля в нижнем регистре).
    const body = {
      number: sender,
      destination: destinationDigits,
      text,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`Exolve SendSMS failed: ${res.status} ${raw}`);
      throw new Error(`Exolve SMS: HTTP ${res.status}`);
    }

    let messageId: string | undefined;
    if (raw.trim()) {
      try {
        const j = JSON.parse(raw) as { message_id?: string; error?: string; message?: string };
        messageId = j.message_id;
        if (j.error) {
          this.logger.warn(`Exolve SendSMS body error: ${raw}`);
          throw new Error(j.error);
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          this.logger.warn(`Exolve SendSMS: ответ не JSON: ${raw.slice(0, 300)}`);
        } else {
          throw e;
        }
      }
    }

    this.logger.log(
      `Exolve SendSMS принят API: destination=${destinationDigits} message_id=${messageId ?? '—'} (статус доставки — в ЛК Exolve)`,
    );
  }
}
