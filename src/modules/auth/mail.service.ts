import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as nodemailer from 'nodemailer';
import {
  otpCodeMail,
  passwordResetMail,
  staffPasswordResetMail,
  staffWelcomeMail,
  type ChatEntityKind,
  type MailContent,
  type MailContext,
  type OtpPurpose,
} from './mail-templates';
import {
  EmailNotificationsService,
  type EmailSendPath,
} from '../email-notifications/email-notifications.service';
import {
  customerGreeting,
  getEmailNotificationEventDef,
  type EmailNotificationEventKey,
  type EmailTemplateVars,
} from '../email-notifications/email-notification-events';
import { renderDefaultEmail } from '../email-notifications/email-notification-render';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly notifications: EmailNotificationsService,
  ) {}

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

  mailContext(): MailContext {
    const siteUrl =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    const logoUrl = this.config.get<string>('MAIL_LOGO_URL')?.trim() || `${siteUrl}/email/wupapa-logo.png`;
    return { siteUrl, logoUrl };
  }

  /** Первый адрес — в `to`, остальные — в `bcc`, чтобы сотрудники не видели адреса друг друга. */
  private async deliver(recipients: string | string[], content: MailContent): Promise<number> {
    const list = Array.isArray(recipients) ? recipients : [recipients];
    const dedup = [...new Set(list.map((e) => e.trim()).filter(Boolean))];
    if (!dedup.length) return 0;
    const from = this.config.get<string>('MAIL_FROM')?.trim() || this.config.get<string>('SMTP_USER');
    if (!from) throw new Error('MAIL_FROM или SMTP_USER нужен для отправки письма');
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    const [primary, ...bcc] = dedup;
    await transport.sendMail({
      from,
      to: primary,
      ...(bcc.length ? { bcc } : {}),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return dedup.length;
  }

  /**
   * Письмо по шаблону из админки. Выключено — не отправляем вовсе;
   * шаблон не загрузился (обычно недоступна БД) — отправляем тексты по умолчанию из реестра.
   */
  private async sendNotification(
    recipients: string | string[],
    eventKey: EmailNotificationEventKey,
    vars: EmailTemplateVars,
  ): Promise<number> {
    const list = (Array.isArray(recipients) ? recipients : [recipients]).filter((e) => e.trim());
    if (!list.length) return 0;
    const ctx = this.mailContext();
    let content: MailContent | null;
    let path: EmailSendPath = 'rendered_db';
    let fallbackReason: string | undefined;
    try {
      content = await this.notifications.build(eventKey, vars, ctx);
    } catch (e) {
      fallbackReason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Шаблон ${eventKey} не загрузился (${fallbackReason}) — отправляем текст по умолчанию`);
      content = renderDefaultEmail(ctx, getEmailNotificationEventDef(eventKey), vars);
      path = 'rendered_legacy';
    }
    if (!content) {
      await this.notifications.recordSendPath(eventKey, 'skipped_disabled');
      this.logger.log(`Email ${eventKey} выключен в админке — не отправляем`);
      return 0;
    }
    try {
      const sent = await this.deliver(list, content);
      await this.notifications.recordSendPath(eventKey, path, fallbackReason);
      return sent;
    } catch (e) {
      await this.notifications.recordSendPath(eventKey, 'failed', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** Тест из редактора уведомлений: тема с пометкой, чтобы не спутать с настоящим письмом. */
  async sendTest(to: string, content: MailContent): Promise<void> {
    await this.deliver(to, { ...content, subject: `[тест] ${content.subject}` });
    this.logger.log(`Test notification email sent to ${to}`);
  }

  async sendRegistrationOtp(to: string, code: string, purpose: OtpPurpose = 'register'): Promise<void> {
    await this.deliver(to, otpCodeMail(this.mailContext(), { code, purpose }));
    this.logger.log(`OTP email (${purpose}) sent to ${to}`);
  }

  async sendPasswordResetLink(params: { to: string; resetLink: string }): Promise<void> {
    await this.deliver(params.to, passwordResetMail(this.mailContext(), { resetLink: params.resetLink }));
    this.logger.log(`Password reset email sent to ${params.to}`);
  }

  async sendDesignerInvite(params: { to: string; inviteLink: string; inviterLabel: string; refCode: string }): Promise<void> {
    const sent = await this.sendNotification(params.to, 'designer_invite', {
      'inviter.name': params.inviterLabel,
      'invite.ref_code': params.refCode,
      'invite.url': params.inviteLink,
      'invite.ttl': '14 дней',
    });
    if (sent) this.logger.log(`Designer invite email sent to ${params.to}`);
  }

  async sendWinWinPartnerApproved(params: { to: string; name: string | null; referralCode: string }): Promise<void> {
    const sent = await this.sendNotification(params.to, 'partner_approved', {
      'customer.greeting': customerGreeting(params.name),
      'partner.ref_code': params.referralCode,
      'account.url': `${this.mailContext().siteUrl}/account/team`,
    });
    if (sent) this.logger.log(`WinWin partner approved email sent to ${params.to}`);
  }

  async sendOrderChatNotifyCustomer(params: {
    to: string;
    customerName: string | null;
    orderDisplayId: string;
    snippet: string;
    accountOrdersUrl: string;
    kind?: ChatEntityKind;
  }): Promise<void> {
    const sourcing = params.kind === 'sourcing';
    const sent = await this.sendNotification(params.to, sourcing ? 'sourcing_chat_reply' : 'order_chat_reply', {
      'customer.greeting': customerGreeting(params.customerName),
      [sourcing ? 'request.id' : 'order.id']: params.orderDisplayId,
      'chat.snippet': params.snippet,
      'chat.url': params.accountOrdersUrl,
    });
    if (sent) this.logger.log(`Chat notify (customer, ${params.kind ?? 'order'}) sent to ${params.to}`);
  }

  async sendOrderChatNotifyStaff(params: {
    recipients: string[];
    orderDisplayId: string;
    orderId: string;
    snippet: string;
    adminOrderUrl: string;
    kind?: ChatEntityKind;
  }): Promise<void> {
    const sourcing = params.kind === 'sourcing';
    const sent = await this.sendNotification(
      params.recipients,
      sourcing ? 'staff_sourcing_chat_message' : 'staff_order_chat_message',
      {
        [sourcing ? 'request.id' : 'order.id']: params.orderDisplayId,
        'chat.snippet': params.snippet,
        'admin.url': params.adminOrderUrl,
      },
    );
    if (sent) this.logger.log(`Chat notify (staff, ${params.kind ?? 'order'}) sent to ${sent} recipient(s)`);
  }

  /** Уведомление о новой заявке на заказ (отправка на согласование). Те же получатели, что и для чата: `ORDER_CHAT_STAFF_EMAIL`. */
  async sendOrderSubmittedPendingApprovalStaff(params: {
    recipients: string[];
    orderDisplayId: string;
    orderId: string;
    adminOrderUrl: string;
  }): Promise<void> {
    const sent = await this.sendNotification(params.recipients, 'staff_order_submitted', {
      'order.id': params.orderDisplayId,
      'order.status': 'На согласовании',
      'admin.url': params.adminOrderUrl,
    });
    if (sent) this.logger.log(`Order pending-approval notify (staff) sent to ${sent} recipient(s)`);
  }

  /** Уведомление о новой заявке на подбор. Те же получатели: `ORDER_CHAT_STAFF_EMAIL`. */
  async sendSourcingSubmittedStaff(params: {
    recipients: string[];
    requestDisplayId: string;
    requestTitle: string;
    adminSourcingUrl: string;
  }): Promise<void> {
    const sent = await this.sendNotification(params.recipients, 'staff_sourcing_submitted', {
      'request.id': params.requestDisplayId,
      'request.title': params.requestTitle.trim() || 'Без названия',
      'admin.url': params.adminSourcingUrl,
    });
    if (sent) this.logger.log(`Sourcing submit notify (staff) sent to ${sent} recipient(s)`);
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
    const sent = await this.sendNotification(params.recipients, 'staff_product_qa_question', {
      'product.title': params.productTitle,
      'qa.topic': params.topicTitle,
      'qa.author': params.authorLabel,
      'qa.text': params.bodyPreview,
      'admin.url': params.adminProductUrl,
      'product.url': params.storefrontUrl,
    });
    if (sent) this.logger.log(`Product QA new question notify (staff) sent to ${sent} recipient(s)`);
  }

  /** Ответ staff в private correspondence по товару. */
  async sendProductQaStaffReplyCustomer(params: {
    to: string;
    customerName: string | null;
    productTitle: string;
    bodyPreview: string;
    accountQuestionsUrl: string;
  }): Promise<void> {
    const sent = await this.sendNotification(params.to, 'product_qa_reply', {
      'customer.greeting': customerGreeting(params.customerName),
      'product.title': params.productTitle,
      'qa.text': params.bodyPreview,
      'questions.url': params.accountQuestionsUrl,
    });
    if (sent) this.logger.log(`Product QA staff reply notify (customer) sent to ${params.to}`);
  }

  /** Вопрос покупателя не прошёл модерацию на витрине. */
  async sendProductQaRejectCustomer(params: {
    to: string;
    customerName: string | null;
    productTitle: string;
    bodyPreview: string;
    accountQuestionsUrl: string;
  }): Promise<void> {
    const sent = await this.sendNotification(params.to, 'product_qa_rejected', {
      'customer.greeting': customerGreeting(params.customerName),
      'product.title': params.productTitle,
      'qa.text': params.bodyPreview,
      'questions.url': params.accountQuestionsUrl,
    });
    if (sent) this.logger.log(`Product QA reject notify (customer) sent to ${params.to}`);
  }

  async sendStaffAdminWelcome(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    await this.deliver(params.to, staffWelcomeMail(this.mailContext(), params));
    this.logger.log(`Staff admin welcome email sent to ${params.to}`);
  }

  async sendStaffAdminPasswordReset(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    await this.deliver(params.to, staffPasswordResetMail(this.mailContext(), params));
    this.logger.log(`Staff admin password reset email sent to ${params.to}`);
  }
}
