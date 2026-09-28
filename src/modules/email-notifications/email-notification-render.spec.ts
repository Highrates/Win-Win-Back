import { describe, expect, it } from 'vitest';
import {
  EMAIL_NOTIFICATION_EVENTS,
  getEmailNotificationEventDef,
  type EmailNotificationEventDef,
} from './email-notification-events';
import { renderEditableEmail, renderDefaultEmail, validateEditableTemplate } from './email-notification-render';

const ctx = { siteUrl: 'https://wupapa.test', now: new Date('2026-09-28T12:00:00Z') };

function defaults(def: EmailNotificationEventDef) {
  return { subject: def.defaultSubject, title: def.defaultTitle, body: def.defaultBody };
}

function sparse(def: EmailNotificationEventDef) {
  const vars = def.sample(ctx.siteUrl);
  for (const v of def.variables) if (v.optional) vars[v.key] = '';
  return vars;
}

describe('editable email notifications', () => {
  it.each(EMAIL_NOTIFICATION_EVENTS.map((d) => [d.key, d] as const))(
    '%s: default template is valid and renders with demo data',
    (_key, def) => {
      expect(validateEditableTemplate(def, defaults(def))).toEqual([]);
      for (const vars of [def.sample(ctx.siteUrl), sparse(def)]) {
        const mail = renderEditableEmail(ctx, def, defaults(def), vars);
        expect(mail.subject).not.toMatch(/\{\{|undefined/);
        expect(mail.html).toMatch(/^<!DOCTYPE html>/);
        expect(mail.html).not.toMatch(/\{\{|undefined|\*\*/);
        expect(mail.text).not.toMatch(/\{\{|undefined|\*\*/);
        expect(mail.html).toContain(`${def.cta.label}</a>`);
      }
    },
  );

  it('capitalizes a line that starts with an empty greeting', () => {
    const def = getEmailNotificationEventDef('order_chat_reply');
    const withName = renderEditableEmail(ctx, def, defaults(def), def.sample(ctx.siteUrl));
    const withoutName = renderEditableEmail(ctx, def, defaults(def), sparse(def));
    expect(withName.text).toContain('Анна, в чате по заказу');
    expect(withoutName.text).toContain('В чате по заказу');

    const partner = getEmailNotificationEventDef('partner_approved');
    const partnerMail = renderEditableEmail(ctx, partner, defaults(partner), sparse(partner));
    expect(partnerMail.text).toContain('Поздравляем!');
    expect(partnerMail.text).not.toContain('поздравляем!');
  });

  it('keeps the case of other leading variables', () => {
    const def = getEmailNotificationEventDef('staff_order_chat_message');
    const mail = renderEditableEmail(
      ctx,
      def,
      { subject: '{{order.id}} — чат', title: '{{chat.snippet}}', body: '{{order.id}}: новое сообщение.\n\n{{admin.url}}' },
      { ...def.sample(ctx.siteUrl), 'order.id': 'c7d2…91af', 'chat.snippet': 'iPhone не подошёл' },
    );
    expect(mail.subject).toBe('c7d2…91af — чат');
    expect(mail.text).toContain('iPhone не подошёл');
    expect(mail.text).toContain('c7d2…91af: новое сообщение.');
    expect(mail.html).toContain('Ответить в админке</a>');
    expect(mail.html).not.toContain('>Https://');
  });

  it('renders snippets, bold, links and bullet lists; escapes values', () => {
    const def = getEmailNotificationEventDef('product_qa_reply');
    const mail = renderEditableEmail(
      ctx,
      def,
      {
        subject: 'Ответ: {{product.title}}',
        title: 'Ответ',
        body: '**Важно:** смотрите {{site.url}}/help.\n\n- раз\n- два\n\n{{block.quote}}\n\n{{questions.url}}',
      },
      { ...def.sample(ctx.siteUrl), 'qa.text': '<script>x</script>', 'product.title': '<b>Стол</b>' },
    );
    expect(mail.subject).toBe('Ответ: <b>Стол</b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(mail.html).toContain('<strong');
    expect(mail.html).toContain('href="https://wupapa.test/help"');
    expect(mail.html).toContain('>раз</td>');
    expect(mail.html).toContain('Открыть переписку</a>');
    expect(mail.text).toContain('Важно: смотрите https://wupapa.test/help.');
  });

  it('does not apply template markup to substituted values', () => {
    const def = getEmailNotificationEventDef('staff_order_chat_message');
    const snippet = '**Срочно** оплатите: https://evil.example/pay\n- пункт';
    const mail = renderEditableEmail(
      ctx,
      def,
      { subject: 'Чат', title: 'Чат', body: '{{chat.snippet}}\n\n- {{chat.snippet}}\n\n{{cta.button}}' },
      { ...def.sample(ctx.siteUrl), 'chat.snippet': snippet },
    );
    expect(mail.html).not.toContain('<strong');
    expect(mail.html).not.toContain('href="https://evil.example');
    expect(mail.html).toContain('**Срочно** оплатите: https://evil.example/pay<br/>- пункт');
    expect(mail.html.match(/>•<\/td>/g)).toHaveLength(1);
    expect(mail.text).toContain(snippet);
  });

  it('keeps template markup around values and links built by the server', () => {
    const def = getEmailNotificationEventDef('staff_order_chat_message');
    const mail = renderEditableEmail(
      ctx,
      def,
      { subject: 'Чат', title: 'Чат', body: 'Заказ **{{order.id}}**: {{admin.url}}\n\n{{cta.button}}' },
      { ...def.sample(ctx.siteUrl), 'order.id': '<a1>' },
    );
    expect(mail.html).toContain('&lt;a1&gt;</strong>');
    const adminUrl = String(def.sample(ctx.siteUrl)['admin.url']);
    expect(mail.html).toContain(`>${adminUrl}</a>`);
  });

  it('rejects blank fields and a body without the action button', () => {
    const def = getEmailNotificationEventDef('order_chat_reply');
    const blank = validateEditableTemplate(def, { subject: '   ', title: ' ', body: '  ' }).join('\n');
    expect(blank).toMatch(/Тема: заполните поле/);
    expect(blank).toMatch(/Заголовок: заполните поле/);
    expect(blank).toMatch(/Сообщение: заполните поле/);

    const noButton = validateEditableTemplate(def, { ...defaults(def), body: 'Просто текст' });
    expect(noButton.join('\n')).toMatch(/нет кнопки «Открыть чат»/);

    const conditional = validateEditableTemplate(def, {
      ...defaults(def),
      body: 'Текст\n\n{{#if customer.greeting}}{{cta.button}}{{/if}}',
    });
    expect(conditional.join('\n')).toMatch(/нет кнопки/);

    expect(validateEditableTemplate(def, { ...defaults(def), body: 'Текст\n\n{{chat.url}}' })).toEqual([]);
  });

  it('renderDefaultEmail uses registry defaults', () => {
    const def = getEmailNotificationEventDef('staff_order_submitted');
    const vars = def.sample(ctx.siteUrl);
    expect(renderDefaultEmail(ctx, def, vars)).toEqual(renderEditableEmail(ctx, def, defaults(def), vars));
  });

  it('drops {{#if}} blocks for empty optional values', () => {
    const def = getEmailNotificationEventDef('partner_approved');
    const tpl = { ...defaults(def), body: '{{#if customer.greeting}}Имя есть{{/if}}\n\n{{cta.button}}' };
    expect(renderEditableEmail(ctx, def, tpl, def.sample(ctx.siteUrl)).text).toContain('Имя есть');
    expect(renderEditableEmail(ctx, def, tpl, sparse(def)).text).not.toContain('Имя есть');
  });

  it('rejects unknown variables, misplaced snippets and bad conditions', () => {
    const def = getEmailNotificationEventDef('staff_order_submitted');
    const errors = validateEditableTemplate(def, {
      subject: '{{order.nope}} {{cta.button}}',
      title: 'ok',
      body: '{{#if order.id}}x{{/if}} {{block.quote}} {{#if order.id}}',
    });
    expect(errors.join('\n')).toMatch(/Тема: неизвестные переменные \{\{order\.nope\}\}/);
    expect(errors.join('\n')).toMatch(/Тема: блоки \{\{cta\.button\}\}/);
    expect(errors.join('\n')).toMatch(/Сообщение: неизвестные переменные \{\{block\.quote\}\}/);
    expect(errors.join('\n')).toMatch(/условие нельзя ставить на \{\{#if order\.id\}\}/);
    expect(errors.join('\n')).toMatch(/свой \{\{\/if\}\}/);
  });
});
