import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private transporter() {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const passRaw = this.config.get<string>('SMTP_PASSWORD') ?? '';
    const pass = passRaw.replace(/\s/g, '');
    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const port = Number(this.config.get('SMTP_PORT', 587));
    const secure =
      String(this.config.get('SMTP_SECURE', 'false')).toLowerCase() === 'true' || port === 465;
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      // Без явных таймаутов TCP к SMTP может висеть минутами → nginx отдаёт 504, пользователь видит «Отправка…».
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
      ...(port === 587 ? { requireTLS: true } : {}),
    });
  }

  async sendRegistrationOtp(to: string, code: string): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');

    const transport = this.transporter();
    await transport.sendMail({
      from,
      to,
      subject: 'Код подтверждения Win-Win',
      text: `Ваш код подтверждения: ${code}\n\nЕсли вы не регистрировались на Win-Win, проигнорируйте письмо.`,
      html: `<p>Ваш код подтверждения: <strong>${code}</strong></p><p>Если вы не регистрировались на Win-Win, проигнорируйте письмо.</p>`,
    });
    this.logger.log(`Registration OTP email sent to ${to}`);
  }
}
