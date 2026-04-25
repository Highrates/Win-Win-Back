import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * На VPS без маршрута IPv6 nodemailer может выбрать AAAA → ENETUNREACH (см. 2a00:1450:… для Gmail).
   * По умолчанию подключаемся к первому A-записи и задаём servername для TLS/SNI.
   */
  private async smtpConnectTarget(hostname: string): Promise<{ host: string; servername?: string }> {
    const raw = String(this.config.get('SMTP_FORCE_IPV4', 'true')).toLowerCase();
    const forceIpv4 = !['0', 'false', 'no', 'off'].includes(raw);
    if (!forceIpv4 || isIP(hostname)) {
      return { host: hostname };
    }
    try {
      const v4 = await resolve4(hostname);
      if (!v4.length) {
        this.logger.warn(`SMTP_FORCE_IPV4: нет A-записей для ${hostname}, подключаемся по имени`);
        return { host: hostname };
      }
      return { host: v4[0], servername: hostname };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SMTP_FORCE_IPV4: resolve4(${hostname}) — ${msg}, подключаемся по имени`);
      return { host: hostname };
    }
  }

  private transporter(target: { host: string; servername?: string }) {
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const passRaw = this.config.get<string>('SMTP_PASSWORD') ?? '';
    const pass = passRaw.replace(/\s/g, '');
    if (!target.host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const port = Number(this.config.get('SMTP_PORT', 587));
    const secure =
      String(this.config.get('SMTP_SECURE', 'false')).toLowerCase() === 'true' || port === 465;
    const requireTls =
      port === 587 &&
      !['0', 'false', 'no', 'off'].includes(
        String(this.config.get('SMTP_REQUIRE_TLS', 'true')).toLowerCase(),
      );
    return nodemailer.createTransport({
      host: target.host,
      ...(target.servername ? { servername: target.servername } : {}),
      port,
      secure,
      auth: { user, pass },
      // Без явных таймаутов TCP к SMTP может висеть минутами → nginx отдаёт 504, пользователь видит «Отправка…».
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
      ...(requireTls ? { requireTLS: true } : {}),
    });
  }

  async sendRegistrationOtp(to: string, code: string): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');

    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    await transport.sendMail({
      from,
      to,
      subject: 'Код подтверждения Win-Win',
      text: `Ваш код подтверждения: ${code}\n\nЕсли вы не регистрировались на Win-Win, проигнорируйте письмо.`,
      html: `<p>Ваш код подтверждения: <strong>${code}</strong></p><p>Если вы не регистрировались на Win-Win, проигнорируйте письмо.</p>`,
    });
    this.logger.log(`Registration OTP email sent to ${to}`);
  }

  async sendDesignerInvite(params: { to: string; inviteLink: string; inviterLabel: string; refCode: string }): Promise<void> {
    const { to, inviteLink, inviterLabel, refCode } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const subject = 'Приглашение стать партнёром Win-Win';
    const text = [
      `${inviterLabel} приглашает вас присоединиться к Win-Win как дизайнер-партнёр.`,
      ``,
      `Реферальный номер в приглашении: ${refCode}`,
      ``,
      `Перейдите по ссылке (действительна 14 дней):`,
      inviteLink,
      ``,
      `Если вы не ждали это письмо, проигнорируйте его.`,
    ].join('\n');
    const html = [
      `<p><strong>${inviterLabel}</strong> приглашает вас стать партнёром Win-Win.</p>`,
      `<p>Реферальный номер: <strong>${refCode}</strong></p>`,
      `<p><a href="${inviteLink}">Перейти к регистрации или входу</a> (ссылка действительна 14 дней)</p>`,
      `<p style="color:#666;font-size:12px">Если вы не ждали письмо, проигнорируйте.</p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Designer invite email sent to ${to}`);
  }

  async sendWinWinPartnerApproved(params: { to: string; name: string | null; referralCode: string }): Promise<void> {
    const { to, name, referralCode } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = name?.trim() ? `${name.trim()}, поздравляем!` : 'Поздравляем!';
    const subject = 'Вы стали партнёром Win-Win';
    const text = [
      hello,
      ``,
      `Ваш статус на Win-Win изменён: вы стали партнёром.`,
      `Ваш реферальный номер: ${referralCode}`,
      ``,
      `Зайдите в личный кабинет, чтобы пригласить других дизайнеров и отслеживать доход.`,
    ].join('\n');
    const html = [
      `<p><strong>${hello}</strong></p>`,
      `<p>Ваш статус на Win-Win изменён: вы стали партнёром.</p>`,
      `<p>Ваш реферальный номер: <strong>${referralCode}</strong></p>`,
      `<p style="color:#666;font-size:12px">Зайдите в личный кабинет, чтобы пригласить других дизайнеров и отслеживать доход.</p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`WinWin partner approved email sent to ${to}`);
  }
}
