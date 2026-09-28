import { EMAIL_NOTIFICATION_EVENTS } from '../email-notifications/email-notification-events';
import { renderDefaultEmail } from '../email-notifications/email-notification-render';
import {
  otpCodeMail,
  passwordResetMail,
  staffPasswordResetMail,
  staffWelcomeMail,
  type MailContent,
  type MailContext,
} from './mail-templates';

export type MailPreview = {
  id: string;
  audience: 'Клиент' | 'Сотрудник';
  trigger: string;
  render: (ctx: MailContext) => MailContent;
};

const AUTH_PREVIEWS: MailPreview[] = [
  {
    id: 'otp-register',
    audience: 'Клиент',
    trigger: 'Регистрация по email — код подтверждения',
    render: (ctx) => otpCodeMail(ctx, { code: '482913', purpose: 'register' }),
  },
  {
    id: 'otp-change-email',
    audience: 'Клиент',
    trigger: 'Смена email в профиле — код подтверждения',
    render: (ctx) => otpCodeMail(ctx, { code: '105774', purpose: 'change-email' }),
  },
  {
    id: 'password-reset',
    audience: 'Клиент',
    trigger: '«Забыли пароль?» — ссылка на сброс',
    render: (ctx) => passwordResetMail(ctx, { resetLink: `${ctx.siteUrl}/reset-password?token=demo` }),
  },
];

const STAFF_ACCESS_PREVIEWS: MailPreview[] = [
  {
    id: 'staff-welcome',
    audience: 'Сотрудник',
    trigger: 'Создан аккаунт сотрудника в админке',
    render: (ctx) =>
      staffWelcomeMail(ctx, {
        to: 'manager@wupapa.ru',
        password: 'Kx7-pQ2m-9Lz',
        loginUrl: `${ctx.siteUrl}/admin/login`,
        staffDisplayName: 'Мария',
      }),
  },
  {
    id: 'staff-password-reset',
    audience: 'Сотрудник',
    trigger: 'Админ сбросил пароль сотруднику',
    render: (ctx) =>
      staffPasswordResetMail(ctx, {
        to: 'manager@wupapa.ru',
        password: 'Rt4-wN8c-2Hy',
        loginUrl: `${ctx.siteUrl}/admin/login`,
        staffDisplayName: 'Мария',
      }),
  },
];

/** Уведомления — тексты по умолчанию из реестра с его же демо-данными (правки из админки сюда не попадают). */
const NOTIFICATION_PREVIEWS: MailPreview[] = EMAIL_NOTIFICATION_EVENTS.map((def) => ({
  id: def.key.replace(/_/g, '-'),
  audience: def.audience === 'staff' ? 'Сотрудник' : 'Клиент',
  trigger: def.label,
  render: (ctx) => renderDefaultEmail(ctx, def, def.sample(ctx.siteUrl)),
}));

/** Все письма, которые отправляет бэкенд, с демо-данными — для превью и тестов вёрстки. */
export const MAIL_PREVIEWS: MailPreview[] = [...AUTH_PREVIEWS, ...NOTIFICATION_PREVIEWS, ...STAFF_ACCESS_PREVIEWS].map(
  (p, i) => ({ ...p, id: `${String(i + 1).padStart(2, '0')}-${p.id}` }),
);
