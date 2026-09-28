import { describe, expect, it } from 'vitest';
import { getEmailNotificationEventDef } from '../email-notifications/email-notification-events';
import { renderDefaultEmail } from '../email-notifications/email-notification-render';
import { MAIL_PREVIEWS } from './mail-previews';
import { otpCodeMail, staffWelcomeMail } from './mail-templates';

const ctx = { siteUrl: 'https://wupapa.test', now: new Date('2026-09-28T12:00:00Z') };

describe('mail templates', () => {
  it.each(MAIL_PREVIEWS.map((p) => [p.id, p] as const))('%s renders subject, text and html', (_id, preview) => {
    const mail = preview.render(ctx);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.text).toContain('wupapa.test');
    expect(mail.html).toMatch(/^<!DOCTYPE html>/);
    expect(mail.html).toContain('© 2026 Wupapa');
    expect(mail.html).not.toContain('undefined');
  });

  it('escapes user-provided values in html', () => {
    const mail = renderDefaultEmail(ctx, getEmailNotificationEventDef('order_chat_reply'), {
      'customer.greeting': '<b>Ann</b>, ',
      'order.id': 'ab…cd',
      'chat.snippet': '<script>alert(1)</script>',
      'chat.url': 'https://wupapa.test/account/orders?tab=work&x="1"',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>Ann</b>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('href="https://wupapa.test/account/orders?tab=work&amp;x=&quot;1&quot;"');
  });

  it('escapes inviter label and keeps plain text readable', () => {
    const mail = renderDefaultEmail(ctx, getEmailNotificationEventDef('designer_invite'), {
      'inviter.name': 'Tom & <Jerry>',
      'invite.ref_code': 'WW-1',
      'invite.url': 'https://wupapa.test/invite?token=t',
      'invite.ttl': '14 дней',
    });
    expect(mail.html).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(mail.text).toContain('Tom & <Jerry> приглашает');
  });

  it('uses sourcing wording for sourcing chat', () => {
    const mail = renderDefaultEmail(ctx, getEmailNotificationEventDef('sourcing_chat_reply'), {
      'customer.greeting': '',
      'request.id': '3b8e…04d2',
      'chat.snippet': 'КП готово',
      'chat.url': 'https://wupapa.test/account/orders?tab=work',
    });
    expect(mail.subject).toBe('Новое сообщение по заявке 3b8e…04d2 — Wupapa');
    expect(mail.text).toContain('В чате по заявке на подбор 3b8e…04d2');
  });

  it('otp change-email variant differs from registration', () => {
    const reg = otpCodeMail(ctx, { code: '123456' });
    const change = otpCodeMail(ctx, { code: '123456', purpose: 'change-email' });
    expect(reg.subject).toBe('Код подтверждения Wupapa');
    expect(change.subject).toBe('Подтвердите новый email — Wupapa');
    expect(change.text).toContain('Если вы не меняли email');
    expect(reg.html).toContain('123456');
  });

  it('uses logo image when MAIL_LOGO_URL is provided', () => {
    const mail = staffWelcomeMail(
      { ...ctx, logoUrl: 'https://wupapa.test/images/wupapa-logo-email.png' },
      { to: 'a@b.c', password: 'p@ss', loginUrl: 'https://wupapa.test/admin/login' },
    );
    expect(mail.html).toContain('<img src="https://wupapa.test/images/wupapa-logo-email.png"');
  });
});
