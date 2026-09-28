import { OTP_TTL_MS } from './otp-challenge.service';
import {
  button,
  codeBox,
  details,
  esc,
  linkFallback,
  note,
  paragraph,
  renderLayout,
  renderText,
  type MailContent,
  type MailContext,
} from './mail-layout';

export type { MailContent, MailContext } from './mail-layout';

export type ChatEntityKind = 'order' | 'sourcing';
export type OtpPurpose = 'register' | 'change-email';

/*
 * Здесь только письма, от которых зависит вход: коды, сброс пароля, доступы сотрудников.
 * Остальные уведомления редактируются в админке — их тексты в `email-notifications/email-notification-events.ts`.
 */

const OTP_TTL_MINUTES = Math.round(OTP_TTL_MS / 60_000);

// ——— Клиентские письма ———

export function otpCodeMail(ctx: MailContext, p: { code: string; purpose?: OtpPurpose }): MailContent {
  const changeEmail = p.purpose === 'change-email';
  const subject = changeEmail ? 'Подтвердите новый email — Wupapa' : 'Код подтверждения Wupapa';
  const title = changeEmail ? 'Подтвердите новый email' : 'Ваш код подтверждения';
  const lead = changeEmail
    ? 'Введите этот код в личном кабинете, чтобы привязать адрес к аккаунту.'
    : 'Введите этот код на сайте, чтобы завершить регистрацию.';
  const ttl = `Код действует ${OTP_TTL_MINUTES} минут. Никому его не сообщайте — сотрудники Wupapa никогда не спрашивают коды.`;
  const footerNote = changeEmail
    ? 'Если вы не меняли email, проигнорируйте письмо — адрес не будет привязан.'
    : 'Если вы не регистрировались на Wupapa, просто проигнорируйте это письмо.';
  return {
    subject,
    html: renderLayout(ctx, {
      subject,
      preheader: `Код ${p.code} — действует ${OTP_TTL_MINUTES} минут`,
      eyebrow: changeEmail ? 'Смена email' : 'Регистрация',
      title,
      blocks: [paragraph(esc(lead)), codeBox(p.code), note(esc(ttl))],
      footerNote,
    }),
    text: renderText(ctx, [title, '', lead, '', `Код: ${p.code}`, '', ttl], footerNote),
  };
}

export function passwordResetMail(ctx: MailContext, p: { resetLink: string }): MailContent {
  const subject = 'Сброс пароля Wupapa';
  const lead = 'Мы получили запрос на смену пароля для вашего аккаунта Wupapa. Нажмите кнопку, чтобы задать новый пароль.';
  const ttl = 'Ссылка действует 1 час.';
  const footerNote = 'Если вы не запрашивали сброс, проигнорируйте письмо — пароль останется прежним.';
  return {
    subject,
    html: renderLayout(ctx, {
      subject,
      preheader: 'Задайте новый пароль — ссылка действует 1 час',
      eyebrow: 'Безопасность',
      title: 'Сброс пароля',
      blocks: [
        paragraph(esc(lead)),
        button('Задать новый пароль', p.resetLink),
        note(esc(ttl)),
        linkFallback(p.resetLink),
      ],
      footerNote,
    }),
    text: renderText(ctx, ['Сброс пароля', '', lead, '', p.resetLink, '', ttl], footerNote),
  };
}

// ——— Письма сотрудникам ———

function staffCredentialsMail(
  ctx: MailContext,
  p: { to: string; password: string; loginUrl: string; staffDisplayName?: string | null },
  variant: 'welcome' | 'reset',
): MailContent {
  const reset = variant === 'reset';
  const subject = reset ? 'Новый пароль админ-панели Wupapa' : 'Доступ в админ-панель Wupapa';
  const title = p.staffDisplayName?.trim() ? `Здравствуйте, ${p.staffDisplayName.trim()}!` : 'Здравствуйте!';
  const lead = reset
    ? 'Администратор сбросил ваш пароль для входа в админ-панель Wupapa.'
    : 'Вам выдан доступ в админ-панель Wupapa.';
  const passwordLabel = reset ? 'Новый пароль' : 'Пароль';
  const keep = 'Сохраните пароль в надёжном месте и не пересылайте это письмо.';
  const footerNote = 'Если вы не ожидали это письмо, сообщите администратору Wupapa.';
  return {
    subject,
    html: renderLayout(ctx, {
      subject,
      preheader: reset ? 'Пароль для входа в админку обновлён' : 'Данные для входа в админку Wupapa',
      eyebrow: 'Админ-панель',
      title,
      blocks: [
        paragraph(esc(lead)),
        details([
          { label: 'Email', value: p.to },
          { label: passwordLabel, value: p.password, mono: true },
        ]),
        button('Войти в админку', p.loginUrl),
        note(esc(keep)),
      ],
      footerNote,
    }),
    text: renderText(
      ctx,
      [title, '', lead, '', `Страница входа: ${p.loginUrl}`, `Email: ${p.to}`, `${passwordLabel}: ${p.password}`, '', keep],
      footerNote,
    ),
  };
}

export function staffWelcomeMail(
  ctx: MailContext,
  p: { to: string; password: string; loginUrl: string; staffDisplayName?: string | null },
): MailContent {
  return staffCredentialsMail(ctx, p, 'welcome');
}

export function staffPasswordResetMail(
  ctx: MailContext,
  p: { to: string; password: string; loginUrl: string; staffDisplayName?: string | null },
): MailContent {
  return staffCredentialsMail(ctx, p, 'reset');
}
