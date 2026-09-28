import type { EmailNotificationAudience } from '@win-win/admin-sections';

/**
 * Реестр редактируемых email-уведомлений — единственный источник их текстов:
 * тексты по умолчанию отсюда же уходят резервной отправкой, если шаблон из БД не собрался.
 * Письма с кодами, ссылками сброса и паролями сотрудников сюда намеренно не входят —
 * их текст остаётся в `auth/mail-templates.ts`, чтобы правка в админке не сломала вход.
 */

export const EMAIL_NOTIFICATION_EVENT_KEYS = [
  'designer_invite',
  'partner_approved',
  'order_chat_reply',
  'sourcing_chat_reply',
  'product_qa_reply',
  'product_qa_rejected',
  'staff_order_chat_message',
  'staff_sourcing_chat_message',
  'staff_order_submitted',
  'staff_sourcing_submitted',
  'staff_product_qa_question',
] as const;

export type EmailNotificationEventKey = (typeof EMAIL_NOTIFICATION_EVENT_KEYS)[number];

export type { EmailNotificationAudience };

export const EMAIL_SNIPPET_KEYS = ['cta.button', 'block.quote', 'block.details'] as const;

export type EmailSnippetKey = (typeof EMAIL_SNIPPET_KEYS)[number];

export type EmailVariableDef = {
  key: string;
  label: string;
  /** Может быть пустым — такие ключи разрешены в `{{#if key}}`. */
  optional?: boolean;
};

export type EmailTemplateVars = Record<string, string | null | undefined>;

export type EmailNotificationEventDef = {
  key: EmailNotificationEventKey;
  audience: EmailNotificationAudience;
  label: string;
  description: string;
  variables: EmailVariableDef[];
  /** `{{cta.button}}` — кнопка; ссылка берётся из переменной `urlKey`. */
  cta: { label: string; urlKey: string; withLinkFallback?: boolean };
  /** `{{block.quote}}` — цитата с текстом из переменной. */
  quote?: { key: string; label: string };
  /** `{{block.details}}` — таблица «подпись — значение». */
  details?: { label: string; key: string }[];
  /** Строка над заголовком (не редактируется, поддерживает переменные). */
  eyebrow: string;
  /** Превью в списке писем почтового клиента; пусто — тема письма. */
  preheader: string;
  footerNote: string;
  defaultSubject: string;
  defaultTitle: string;
  defaultBody: string;
  /** Полные demo-данные; для варианта «без необязательных» optional-ключи очищаются. */
  sample: (siteUrl: string) => EmailTemplateVars;
};

export const EMAIL_GLOBAL_VARIABLES: EmailVariableDef[] = [{ key: 'site.url', label: 'Адрес сайта' }];

const CUSTOMER_GREETING: EmailVariableDef = {
  key: 'customer.greeting',
  label: 'Обращение «Анна, » (пусто, если имя не указано)',
  optional: true,
};

/** Если строка начинается с пустого обращения, следующий за ним текст пишется с заглавной. */
export const EMAIL_GREETING_KEYS: ReadonlySet<string> = new Set([CUSTOMER_GREETING.key]);

const STAFF_FOOTER = 'Служебное уведомление Wupapa для сотрудников.';

export const EMAIL_NOTIFICATION_EVENTS: EmailNotificationEventDef[] = [
  {
    key: 'designer_invite',
    audience: 'customer',
    label: 'Приглашение дизайнера',
    description: 'Партнёр пригласил дизайнера по email.',
    variables: [
      { key: 'inviter.name', label: 'Кто приглашает' },
      { key: 'invite.ref_code', label: 'Реферальный номер' },
      { key: 'invite.url', label: 'Ссылка-приглашение' },
      { key: 'invite.ttl', label: 'Срок действия ссылки' },
    ],
    cta: { label: 'Принять приглашение', urlKey: 'invite.url', withLinkFallback: true },
    details: [
      { label: 'Реферальный номер', key: 'invite.ref_code' },
      { label: 'Ссылка действует', key: 'invite.ttl' },
    ],
    eyebrow: 'Приглашение',
    preheader: '{{inviter.name}} приглашает вас в Wupapa как дизайнера-партнёра',
    footerNote: 'Если вы не ждали это письмо, просто проигнорируйте его.',
    defaultSubject: 'Приглашение стать партнёром Wupapa',
    defaultTitle: 'Вас приглашают в Wupapa',
    defaultBody: [
      '**{{inviter.name}}** приглашает вас присоединиться к Wupapa как дизайнер-партнёр.',
      '{{block.details}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'inviter.name': 'Анна Смирнова',
      'invite.ref_code': 'WW-4821',
      'invite.url': `${site}/invite/designer?token=demo`,
      'invite.ttl': '14 дней',
    }),
  },
  {
    key: 'partner_approved',
    audience: 'customer',
    label: 'Партнёрство одобрено',
    description: 'Администратор одобрил заявку на партнёрство.',
    variables: [
      CUSTOMER_GREETING,
      { key: 'partner.ref_code', label: 'Реферальный номер партнёра' },
      { key: 'account.url', label: 'Ссылка на личный кабинет' },
    ],
    cta: { label: 'Открыть личный кабинет', urlKey: 'account.url' },
    details: [{ label: 'Реферальный номер', key: 'partner.ref_code' }],
    eyebrow: 'Партнёрская программа',
    preheader: 'Заявка одобрена. Ваш реферальный номер — {{partner.ref_code}}',
    footerNote: 'Вы получили это письмо, потому что подали заявку на партнёрство в Wupapa.',
    defaultSubject: 'Вы стали партнёром Wupapa',
    defaultTitle: '{{customer.greeting}}поздравляем!',
    defaultBody: [
      'Ваша заявка одобрена — теперь вы партнёр Wupapa.',
      '{{block.details}}',
      'Приглашайте дизайнеров и отслеживайте доход в личном кабинете.',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'customer.greeting': 'Анна, ',
      'partner.ref_code': 'WW-4821',
      'account.url': `${site}/account/team`,
    }),
  },
  {
    key: 'order_chat_reply',
    audience: 'customer',
    label: 'Ответ менеджера в чате заказа',
    description: 'Менеджер написал клиенту в чат заказа.',
    variables: [
      CUSTOMER_GREETING,
      { key: 'order.id', label: 'Номер заказа' },
      { key: 'chat.snippet', label: 'Текст сообщения' },
      { key: 'chat.url', label: 'Ссылка на чат' },
    ],
    cta: { label: 'Открыть чат', urlKey: 'chat.url' },
    quote: { key: 'chat.snippet', label: 'Цитата сообщения' },
    eyebrow: 'Заказ {{order.id}}',
    preheader: '{{chat.snippet}}',
    footerNote: 'Вы получили это письмо, потому что оформили заказ на Wupapa.',
    defaultSubject: 'Новое сообщение по заказу {{order.id}} — Wupapa',
    defaultTitle: 'Вам ответил менеджер',
    defaultBody: [
      '{{customer.greeting}}в чате по заказу {{order.id}} новое сообщение от менеджера.',
      '{{block.quote}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'customer.greeting': 'Анна, ',
      'order.id': 'c7d2…91af',
      'chat.snippet': 'Добрый день! Диван будет на складе 14 октября, доставку можем назначить на 15-е. Подходит?',
      'chat.url': `${site}/account/orders?tab=work`,
    }),
  },
  {
    key: 'sourcing_chat_reply',
    audience: 'customer',
    label: 'Ответ менеджера в чате заявки на подбор',
    description: 'Менеджер написал клиенту в чат заявки на подбор.',
    variables: [
      CUSTOMER_GREETING,
      { key: 'request.id', label: 'Номер заявки' },
      { key: 'chat.snippet', label: 'Текст сообщения' },
      { key: 'chat.url', label: 'Ссылка на чат' },
    ],
    cta: { label: 'Открыть чат', urlKey: 'chat.url' },
    quote: { key: 'chat.snippet', label: 'Цитата сообщения' },
    eyebrow: 'Заявка на подбор {{request.id}}',
    preheader: '{{chat.snippet}}',
    footerNote: 'Вы получили это письмо, потому что оставили заявку на подбор на Wupapa.',
    defaultSubject: 'Новое сообщение по заявке {{request.id}} — Wupapa',
    defaultTitle: 'Вам ответил менеджер',
    defaultBody: [
      '{{customer.greeting}}в чате по заявке на подбор {{request.id}} новое сообщение от менеджера.',
      '{{block.quote}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'customer.greeting': 'Анна, ',
      'request.id': '3b8e…04d2',
      'chat.snippet': 'Подобрали три варианта обеденного стола под ваш размер — КП уже в заявке.',
      'chat.url': `${site}/account/orders?tab=work`,
    }),
  },
  {
    key: 'product_qa_reply',
    audience: 'customer',
    label: 'Ответ на вопрос о товаре',
    description: 'Магазин ответил покупателю в личной переписке по товару.',
    variables: [
      CUSTOMER_GREETING,
      { key: 'product.title', label: 'Название товара' },
      { key: 'qa.text', label: 'Текст ответа' },
      { key: 'questions.url', label: 'Ссылка на «Мои вопросы»' },
    ],
    cta: { label: 'Открыть переписку', urlKey: 'questions.url' },
    quote: { key: 'qa.text', label: 'Цитата ответа' },
    eyebrow: 'Вопрос о товаре',
    preheader: '{{qa.text}}',
    footerNote: 'Вы получили это письмо, потому что задали вопрос о товаре на Wupapa.',
    defaultSubject: 'Ответ по товару «{{product.title}}» — Wupapa',
    defaultTitle: 'Магазин ответил на ваш вопрос',
    defaultBody: [
      '{{customer.greeting}}ответ по товару **«{{product.title}}»**:',
      '{{block.quote}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'customer.greeting': 'Анна, ',
      'product.title': 'Диван «Эталон»',
      'qa.text': 'Да, чехол съёмный, его можно сдавать в химчистку.',
      'questions.url': `${site}/account/questions`,
    }),
  },
  {
    key: 'product_qa_rejected',
    audience: 'customer',
    label: 'Вопрос о товаре не опубликован',
    description: 'Вопрос покупателя не прошёл модерацию на витрине.',
    variables: [
      CUSTOMER_GREETING,
      { key: 'product.title', label: 'Название товара' },
      { key: 'qa.text', label: 'Текст вопроса' },
      { key: 'questions.url', label: 'Ссылка на «Мои вопросы»' },
    ],
    cta: { label: 'Перейти в «Мои вопросы»', urlKey: 'questions.url' },
    quote: { key: 'qa.text', label: 'Цитата вопроса' },
    eyebrow: 'Вопрос о товаре',
    preheader: 'Вопрос не прошёл модерацию, но магазин может ответить лично',
    footerNote: 'Вы получили это письмо, потому что задали вопрос о товаре на Wupapa.',
    defaultSubject: 'Вопрос по товару «{{product.title}}» не опубликован — Wupapa',
    defaultTitle: 'Вопрос не опубликован',
    defaultBody: [
      '{{customer.greeting}}ваш вопрос по товару **«{{product.title}}»** не прошёл модерацию и не появится на странице товара.',
      '{{block.quote}}',
      'Магазин по-прежнему может ответить вам лично — переписка доступна в разделе «Мои вопросы».',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'customer.greeting': 'Анна, ',
      'product.title': 'Диван «Эталон»',
      'qa.text': 'Можно ли купить дешевле, если без доставки?',
      'questions.url': `${site}/account/questions`,
    }),
  },
  {
    key: 'staff_order_chat_message',
    audience: 'staff',
    label: 'Сообщение клиента в чате заказа',
    description: 'Клиент написал в чат заказа.',
    variables: [
      { key: 'order.id', label: 'Номер заказа' },
      { key: 'chat.snippet', label: 'Текст сообщения' },
      { key: 'admin.url', label: 'Ссылка на заказ в админке' },
    ],
    cta: { label: 'Ответить в админке', urlKey: 'admin.url' },
    quote: { key: 'chat.snippet', label: 'Цитата сообщения' },
    eyebrow: 'Заказ {{order.id}}',
    preheader: '{{chat.snippet}}',
    footerNote: STAFF_FOOTER,
    defaultSubject: 'Новое сообщение в чате заказа {{order.id}} — Wupapa',
    defaultTitle: 'Клиент написал в чат',
    defaultBody: ['Клиент написал в чат по заказу {{order.id}}.', '{{block.quote}}', '{{cta.button}}'].join(
      '\n\n',
    ),
    sample: (site) => ({
      'order.id': 'c7d2…91af',
      'chat.snippet': 'Подходит 15-е, после 12:00. Подъём на 4 этаж без лифта.',
      'admin.url': `${site}/admin/orders/demo#order-chat`,
    }),
  },
  {
    key: 'staff_sourcing_chat_message',
    audience: 'staff',
    label: 'Сообщение клиента в чате заявки на подбор',
    description: 'Клиент написал в чат заявки на подбор.',
    variables: [
      { key: 'request.id', label: 'Номер заявки' },
      { key: 'chat.snippet', label: 'Текст сообщения' },
      { key: 'admin.url', label: 'Ссылка на заявку в админке' },
    ],
    cta: { label: 'Ответить в админке', urlKey: 'admin.url' },
    quote: { key: 'chat.snippet', label: 'Цитата сообщения' },
    eyebrow: 'Заявка на подбор {{request.id}}',
    preheader: '{{chat.snippet}}',
    footerNote: STAFF_FOOTER,
    defaultSubject: 'Новое сообщение в чате заявки {{request.id}} — Wupapa',
    defaultTitle: 'Клиент написал в чат',
    defaultBody: [
      'Клиент написал в чат по заявке на подбор {{request.id}}.',
      '{{block.quote}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'request.id': '3b8e…04d2',
      'chat.snippet': 'Спасибо! Второй вариант нравится — можно фото в интерьере?',
      'admin.url': `${site}/admin/orders/sourcing/demo`,
    }),
  },
  {
    key: 'staff_order_submitted',
    audience: 'staff',
    label: 'Новый заказ на согласование',
    description: 'Клиент отправил заказ на согласование.',
    variables: [
      { key: 'order.id', label: 'Номер заказа' },
      { key: 'order.status', label: 'Статус заказа' },
      { key: 'admin.url', label: 'Ссылка на заказ в админке' },
    ],
    cta: { label: 'Открыть заказ', urlKey: 'admin.url' },
    details: [
      { label: 'Заказ', key: 'order.id' },
      { label: 'Статус', key: 'order.status' },
    ],
    eyebrow: 'Новый заказ',
    preheader: 'Заказ {{order.id}} ждёт согласования',
    footerNote: STAFF_FOOTER,
    defaultSubject: 'Новая заявка на заказ {{order.id}} — Wupapa',
    defaultTitle: 'Заказ {{order.id}} ждёт согласования',
    defaultBody: [
      'Клиент отправил заказ на согласование. Проверьте состав заказа в админке.',
      '{{block.details}}',
      '{{cta.button}}',
    ].join('\n\n'),
    sample: (site) => ({
      'order.id': 'c7d2…91af',
      'order.status': 'На согласовании',
      'admin.url': `${site}/admin/orders/demo`,
    }),
  },
  {
    key: 'staff_sourcing_submitted',
    audience: 'staff',
    label: 'Новая заявка на подбор',
    description: 'Клиент отправил заявку на подбор.',
    variables: [
      { key: 'request.id', label: 'Номер заявки' },
      { key: 'request.title', label: 'Тема заявки' },
      { key: 'admin.url', label: 'Ссылка на заявку в админке' },
    ],
    cta: { label: 'Открыть заявку', urlKey: 'admin.url' },
    details: [
      { label: 'Заявка', key: 'request.id' },
      { label: 'Тема', key: 'request.title' },
    ],
    eyebrow: 'Новая заявка на подбор',
    preheader: '{{request.id}}: {{request.title}}',
    footerNote: STAFF_FOOTER,
    defaultSubject: 'Новая заявка на подбор {{request.id}} — Wupapa',
    defaultTitle: 'Клиент ждёт подбора',
    defaultBody: ['Клиент отправил заявку на подбор.', '{{block.details}}', '{{cta.button}}'].join('\n\n'),
    sample: (site) => ({
      'request.id': '3b8e…04d2',
      'request.title': 'Обеденный стол 180×90, дуб',
      'admin.url': `${site}/admin/orders/sourcing/demo`,
    }),
  },
  {
    key: 'staff_product_qa_question',
    audience: 'staff',
    label: 'Новый вопрос о товаре',
    description: 'Покупатель задал вопрос на странице товара.',
    variables: [
      { key: 'product.title', label: 'Название товара' },
      { key: 'qa.topic', label: 'Тема вопроса' },
      { key: 'qa.author', label: 'Автор вопроса' },
      { key: 'qa.text', label: 'Текст вопроса' },
      { key: 'admin.url', label: 'Ссылка на товар в админке' },
      { key: 'product.url', label: 'Ссылка на товар на витрине' },
    ],
    cta: { label: 'Ответить в админке', urlKey: 'admin.url' },
    quote: { key: 'qa.text', label: 'Цитата вопроса' },
    details: [
      { label: 'Товар', key: 'product.title' },
      { label: 'Тема', key: 'qa.topic' },
      { label: 'Автор', key: 'qa.author' },
    ],
    eyebrow: 'Вопрос о товаре',
    preheader: '{{qa.text}}',
    footerNote: STAFF_FOOTER,
    defaultSubject: 'Новый вопрос по товару: {{product.title}} — Wupapa',
    defaultTitle: 'Новый вопрос покупателя',
    defaultBody: [
      '{{block.details}}',
      '{{block.quote}}',
      '{{cta.button}}',
      'Товар на витрине: {{product.url}}',
    ].join('\n\n'),
    sample: (site) => ({
      'product.title': 'Диван «Эталон»',
      'qa.topic': 'Уход за тканью',
      'qa.author': 'Анна С.',
      'qa.text': 'Чехол съёмный? Можно ли его стирать?',
      'admin.url': `${site}/admin/catalog/products/demo`,
      'product.url': `${site}/product/divan-etalon`,
    }),
  },
];

const EVENTS_BY_KEY = new Map(EMAIL_NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function isEmailNotificationEventKey(value: string): value is EmailNotificationEventKey {
  return EVENTS_BY_KEY.has(value as EmailNotificationEventKey);
}

export function getEmailNotificationEventDef(key: EmailNotificationEventKey): EmailNotificationEventDef {
  const def = EVENTS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown email notification event: ${key}`);
  return def;
}

/** Блоки, которые можно вставить в текст письма этого события. */
export function eventSnippets(def: EmailNotificationEventDef): { key: EmailSnippetKey; label: string }[] {
  const out: { key: EmailSnippetKey; label: string }[] = [
    { key: 'cta.button', label: `Кнопка «${def.cta.label}»` },
  ];
  if (def.quote) out.push({ key: 'block.quote', label: def.quote.label });
  if (def.details?.length) {
    out.push({ key: 'block.details', label: `Таблица: ${def.details.map((d) => d.label).join(', ')}` });
  }
  return out;
}

export function defaultTemplate(def: EmailNotificationEventDef): { subject: string; title: string; body: string } {
  return { subject: def.defaultSubject, title: def.defaultTitle, body: def.defaultBody };
}

export function customerGreeting(name: string | null | undefined): string {
  return name?.trim() ? `${name.trim()}, ` : '';
}
