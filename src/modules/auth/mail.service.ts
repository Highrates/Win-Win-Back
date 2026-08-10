import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as nodemailer from 'nodemailer';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  async sendPasswordResetLink(params: { to: string; resetLink: string }): Promise<void> {
    const { to, resetLink } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const subject = 'Сброс пароля Win-Win';
    const text = [
      `Вы запросили сброс пароля на Win-Win.`,
      ``,
      `Перейдите по ссылке (действительна 1 час):`,
      resetLink,
      ``,
      `Если вы не запрашивали сброс, проигнорируйте письмо.`,
    ].join('\n');
    const html = [
      `<p>Вы запросили сброс пароля на Win-Win.</p>`,
      `<p><a href="${resetLink}">Задать новый пароль</a> (ссылка действительна 1 час)</p>`,
      `<p style="color:#666;font-size:12px">Если вы не запрашивали сброс, проигнорируйте письмо.</p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Password reset email sent to ${to}`);
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

  async sendOrderChatNotifyCustomer(params: {
    to: string;
    customerName: string | null;
    orderDisplayId: string;
    snippet: string;
    accountOrdersUrl: string;
  }): Promise<void> {
    const { to, customerName, orderDisplayId, snippet, accountOrdersUrl } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = customerName?.trim() ? `${customerName.trim()}, ` : '';
    const subject = `Новое сообщение по заказу ${orderDisplayId} — Win-Win`;
    const text = [
      `${hello}вам ответили в чате по заказу ${orderDisplayId}.`,
      ``,
      snippet,
      ``,
      `Открыть заказы и чат: ${accountOrdersUrl}`,
    ].join('\n');
    const html = [
      `<p>${hello}вам ответили в чате по заказу <strong>${orderDisplayId}</strong>.</p>`,
      `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ccc">${snippet.replace(/</g, '&lt;')}</blockquote>`,
      `<p><a href="${accountOrdersUrl}">Перейти в личный кабинет → заказы</a></p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Order chat notify (customer) sent to ${to}`);
  }

  async sendOrderChatNotifyStaff(params: {
    recipients: string[];
    orderDisplayId: string;
    orderId: string;
    snippet: string;
    adminOrderUrl: string;
  }): Promise<void> {
    const dedup = [...new Set(params.recipients.map((e) => e.trim()).filter(Boolean))];
    if (!dedup.length) return;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const [primary, ...bcc] = dedup;
    const subject = `Новое сообщение в чате заказа ${params.orderDisplayId} — Win-Win`;
    const text = [
      `Клиент написал в чат по заказу ${params.orderDisplayId}.`,
      ``,
      params.snippet,
      ``,
      `Открыть заказ: ${params.adminOrderUrl}`,
    ].join('\n');
    const html = [
      `<p>Клиент написал в чат по заказу <strong>${params.orderDisplayId}</strong>.</p>`,
      `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ccc">${params.snippet.replace(/</g, '&lt;')}</blockquote>`,
      `<p><a href="${params.adminOrderUrl}">Открыть заказ в админке</a></p>`,
    ].join('');
    await transport.sendMail({
      from,
      to: primary,
      ...(bcc.length ? { bcc } : {}),
      subject,
      text,
      html,
    });
    this.logger.log(`Order chat notify (staff) sent to ${dedup.length} recipient(s)`);
  }

  /** Уведомление о новой заявке на заказ (отправка на согласование). Те же получатели, что и для чата: `ORDER_CHAT_STAFF_EMAIL`. */
  async sendOrderSubmittedPendingApprovalStaff(params: {
    recipients: string[];
    orderDisplayId: string;
    orderId: string;
    adminOrderUrl: string;
  }): Promise<void> {
    const dedup = [...new Set(params.recipients.map((e) => e.trim()).filter(Boolean))];
    if (!dedup.length) return;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const [primary, ...bcc] = dedup;
    const subject = `Новая заявка на заказ ${params.orderDisplayId} — Win-Win`;
    const text = [
      `Клиент отправил заказ на согласование (заказ ${params.orderDisplayId}).`,
      ``,
      `Открыть в админке: ${params.adminOrderUrl}`,
    ].join('\n');
    const html = [
      `<p>Клиент отправил заказ на согласование: <strong>${params.orderDisplayId}</strong>.</p>`,
      `<p><a href="${params.adminOrderUrl}">Открыть заказ в админке</a></p>`,
    ].join('');
    await transport.sendMail({
      from,
      to: primary,
      ...(bcc.length ? { bcc } : {}),
      subject,
      text,
      html,
    });
    this.logger.log(`Order pending-approval notify (staff) sent to ${dedup.length} recipient(s)`);
  }

  /** Уведомление о новой заявке на подбор. Те же получатели: `ORDER_CHAT_STAFF_EMAIL`. */
  async sendSourcingSubmittedStaff(params: {
    recipients: string[];
    requestDisplayId: string;
    requestTitle: string;
    adminSourcingUrl: string;
  }): Promise<void> {
    const dedup = [...new Set(params.recipients.map((e) => e.trim()).filter(Boolean))];
    if (!dedup.length) return;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const [primary, ...bcc] = dedup;
    const title = params.requestTitle.trim() || 'Без названия';
    const subject = `Новая заявка на подбор ${params.requestDisplayId} — Win-Win`;
    const text = [
      `Клиент отправил заявку на подбор (${params.requestDisplayId}).`,
      `Тема: ${title}`,
      ``,
      `Открыть в админке: ${params.adminSourcingUrl}`,
    ].join('\n');
    const html = [
      `<p>Клиент отправил заявку на подбор: <strong>${params.requestDisplayId}</strong>.</p>`,
      `<p>Тема: <strong>${title}</strong></p>`,
      `<p><a href="${params.adminSourcingUrl}">Открыть заявку в админке</a></p>`,
    ].join('');
    await transport.sendMail({
      from,
      to: primary,
      ...(bcc.length ? { bcc } : {}),
      subject,
      text,
      html,
    });
    this.logger.log(`Sourcing submit notify (staff) sent to ${dedup.length} recipient(s)`);
  }

  /** Новый вопрос покупателя по товару. Получатели: `ORDER_CHAT_STAFF_EMAIL`. */
  async sendProductQaNewQuestionStaff(params: {
    recipients: string[];
    productTitle: string;
    topicTitle: string;
    authorLabel: string;
    bodyPreview: string;
    adminProductUrl: string;
    storefrontUrl: string;
  }): Promise<void> {
    const dedup = [...new Set(params.recipients.map((e) => e.trim()).filter(Boolean))];
    if (!dedup.length) return;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const [primary, ...bcc] = dedup;
    const productTitle = escapeHtml(params.productTitle);
    const topicTitle = escapeHtml(params.topicTitle);
    const authorLabel = escapeHtml(params.authorLabel);
    const bodyPreview = escapeHtml(params.bodyPreview);
    const subject = `Новый вопрос по товару: ${params.productTitle} — Win-Win`;
    const text = [
      `Новый вопрос на витрине.`,
      `Товар: ${params.productTitle}`,
      `Тема: ${params.topicTitle}`,
      `Автор: ${params.authorLabel}`,
      ``,
      params.bodyPreview,
      ``,
      `Админка: ${params.adminProductUrl}`,
      `Витрина: ${params.storefrontUrl}`,
    ].join('\n');
    const html = [
      `<p>Новый вопрос по товару <strong>${productTitle}</strong>.</p>`,
      `<p>Тема: <strong>${topicTitle}</strong><br/>Автор: <strong>${authorLabel}</strong></p>`,
      `<p style="white-space:pre-wrap">${bodyPreview}</p>`,
      `<p><a href="${params.adminProductUrl}">Открыть в админке</a> · <a href="${params.storefrontUrl}">На витрине</a></p>`,
    ].join('');
    await transport.sendMail({
      from,
      to: primary,
      ...(bcc.length ? { bcc } : {}),
      subject,
      text,
      html,
    });
    this.logger.log(`Product QA new question notify (staff) sent to ${dedup.length} recipient(s)`);
  }

  /** Ответ staff в private correspondence по товару. */
  async sendProductQaStaffReplyCustomer(params: {
    to: string;
    customerName: string | null;
    productTitle: string;
    bodyPreview: string;
    accountQuestionsUrl: string;
  }): Promise<void> {
    const { to, customerName, productTitle, bodyPreview, accountQuestionsUrl } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = customerName?.trim() ? `${customerName.trim()}, ` : '';
    const title = escapeHtml(productTitle);
    const preview = escapeHtml(bodyPreview);
    const subject = `Ответ по товару «${productTitle}» — Win-Win`;
    const text = [
      `${hello}магазин ответил на ваш вопрос по товару «${productTitle}».`,
      ``,
      bodyPreview,
      ``,
      `Открыть переписку: ${accountQuestionsUrl}`,
    ].join('\n');
    const html = [
      `<p>${hello}магазин ответил на ваш вопрос по товару <strong>${title}</strong>.</p>`,
      `<p style="white-space:pre-wrap">${preview}</p>`,
      `<p><a href="${accountQuestionsUrl}">Перейти в «Мои вопросы»</a></p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Product QA staff reply notify (customer) sent to ${to}`);
  }

  /** Вопрос покупателя не прошёл модерацию на витрине. */
  async sendProductQaRejectCustomer(params: {
    to: string;
    customerName: string | null;
    productTitle: string;
    bodyPreview: string;
    accountQuestionsUrl: string;
  }): Promise<void> {
    const { to, customerName, productTitle, bodyPreview, accountQuestionsUrl } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = customerName?.trim() ? `${customerName.trim()}, ` : '';
    const title = escapeHtml(productTitle);
    const preview = escapeHtml(bodyPreview);
    const subject = `Вопрос по товару «${productTitle}» не опубликован — Win-Win`;
    const text = [
      `${hello}к сожалению, ваш вопрос по товару «${productTitle}» не был опубликован на витрине.`,
      `Вы по-прежнему можете получить ответ в личной переписке с магазином.`,
      ``,
      bodyPreview,
      ``,
      `Открыть «Мои вопросы»: ${accountQuestionsUrl}`,
    ].join('\n');
    const html = [
      `<p>${hello}к сожалению, ваш вопрос по товару <strong>${title}</strong> не был опубликован на витрине.</p>`,
      `<p>Вы по-прежнему можете получить ответ в личной переписке с магазином.</p>`,
      `<p style="white-space:pre-wrap">${preview}</p>`,
      `<p><a href="${accountQuestionsUrl}">Перейти в «Мои вопросы»</a></p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Product QA reject notify (customer) sent to ${to}`);
  }

  async sendStaffAdminWelcome(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    const { to, password, loginUrl, staffDisplayName } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = staffDisplayName?.trim()
      ? `Здравствуйте, ${staffDisplayName.trim()}!`
      : 'Здравствуйте!';
    const subject = 'Доступ в админ-панель Win-Win';
    const text = [
      hello,
      '',
      'Вам выдан доступ в админ-панель Win-Win.',
      '',
      `Страница входа: ${loginUrl}`,
      `Email для входа: ${to}`,
      `Пароль: ${password}`,
      '',
      'Сохраните пароль в надёжном месте. Если вы не ожидали это письмо, обратитесь к администратору Win-Win.',
    ].join('\n');
    const html = [
      `<p>${hello}</p>`,
      `<p>Вам выдан доступ в <strong>админ-панель Win-Win</strong>.</p>`,
      `<p><a href="${loginUrl}">Войти в админку</a></p>`,
      `<p>Email: <strong>${to}</strong><br/>Пароль: <strong>${password}</strong></p>`,
      `<p style="color:#666;font-size:12px">Сохраните пароль в надёжном месте. Если вы не ожидали письмо, обратитесь к администратору Win-Win.</p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Staff admin welcome email sent to ${to}`);
  }

  async sendStaffAdminPasswordReset(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    const { to, password, loginUrl, staffDisplayName } = params;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const hello = staffDisplayName?.trim()
      ? `Здравствуйте, ${staffDisplayName.trim()}!`
      : 'Здравствуйте!';
    const subject = 'Новый пароль админ-панели Win-Win';
    const text = [
      hello,
      '',
      'Администратор сбросил ваш пароль для входа в админ-панель Win-Win.',
      '',
      `Страница входа: ${loginUrl}`,
      `Email для входа: ${to}`,
      `Новый пароль: ${password}`,
      '',
      'Сохраните пароль в надёжном месте. Если вы не ожидали это письмо, обратитесь к администратору Win-Win.',
    ].join('\n');
    const html = [
      `<p>${hello}</p>`,
      `<p>Администратор сбросил ваш пароль для входа в <strong>админ-панель Win-Win</strong>.</p>`,
      `<p><a href="${loginUrl}">Войти в админку</a></p>`,
      `<p>Email: <strong>${to}</strong><br/>Новый пароль: <strong>${password}</strong></p>`,
      `<p style="color:#666;font-size:12px">Сохраните пароль в надёжном месте. Если вы не ожидали письмо, обратитесь к администратору Win-Win.</p>`,
    ].join('');
    await transport.sendMail({ from, to, subject, text, html });
    this.logger.log(`Staff admin password reset email sent to ${to}`);
  }
}
