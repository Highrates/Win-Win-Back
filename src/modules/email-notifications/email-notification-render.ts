import type { EmailTemplateFields } from '@win-win/admin-sections';
import {
  bulletList,
  button,
  details,
  esc,
  linkFallback,
  paragraph,
  quote,
  renderLayout,
  renderText,
  strong,
  textLink,
  type MailContent,
  type MailContext,
} from '../auth/mail-layout';
import {
  EMAIL_GLOBAL_VARIABLES,
  EMAIL_GREETING_KEYS,
  EMAIL_SNIPPET_KEYS,
  defaultTemplate,
  eventSnippets,
  type EmailNotificationEventDef,
  type EmailSnippetKey,
  type EmailTemplateVars,
} from './email-notification-events';

export type EditableTemplate = EmailTemplateFields;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const SOLE_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;
/** Без else и вложенности: внутренний `{{#if` не поддерживается. */
const IF_BLOCK_RE = /\{\{#if\s+([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;
/** Маска значения переменной: символы из Private Use Area не встречаются в шаблоне и не входят в ссылку. */
const MASK_OPEN = '\uE000';
const MASK_CLOSE = '\uE001';
const MASK_RE = /\uE000(\d+)\uE001/g;
const URL_RE = /https?:\/\/[^\s<>"'\uE000]+/g;
const URL_TRAILING_PUNCT_RE = /[.,;:!?)»]+$/;
const BULLET_RE = /^\s*(?:•|-)\s+/;

export function isEmailSnippetKey(value: string): value is EmailSnippetKey {
  return (EMAIL_SNIPPET_KEYS as readonly string[]).includes(value);
}

function varValue(vars: EmailTemplateVars, key: string): string {
  return String(vars[key] ?? '').trim();
}

function expandIfBlocks(template: string, vars: EmailTemplateVars): string {
  return template.replace(IF_BLOCK_RE, (_m, key: string, inner: string) =>
    varValue(vars, key.trim()) ? inner : '',
  );
}

/** Ссылки `*.url` строит сервер — им можно становиться ссылками в тексте; остальные значения (текст клиента, имена) — нет. */
function isLinkVariable(key: string): boolean {
  return key.endsWith('.url');
}

/**
 * Без `masked` — простая подстановка (тема, заголовок, preheader).
 * С `masked` — значения, кроме ссылок сервера, заменяются масками: разметка шаблона (`**`, списки, автоссылки)
 * применяется только к тексту админа, а значение потом подставляется как есть — `**` или ссылка
 * в сообщении клиента не станут жирным или кликабельными.
 */
function interpolate(template: string, vars: EmailTemplateVars, masked?: string[]): string {
  return template.replace(PLACEHOLDER_RE, (_m, raw: string) => {
    const key = raw.trim();
    if (isEmailSnippetKey(key)) return '';
    const value = String(vars[key] ?? '');
    if (!masked || !value || isLinkVariable(key)) return value;
    masked.push(value);
    return `${MASK_OPEN}${masked.length - 1}${MASK_CLOSE}`;
  });
}

function unmaskHtml(html: string, masked: string[]): string {
  return html.replace(MASK_RE, (_m, i: string) => esc(masked[Number(i)] ?? '').replace(/\n/g, '<br/>'));
}

function unmaskText(text: string, masked: string[]): string {
  return text.replace(MASK_RE, (_m, i: string) => masked[Number(i)] ?? '');
}

const LEADING_PLACEHOLDER_RE = /^\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/;

function capitalizeFirst(s: string): string {
  return s.replace(/^(\s*)(\p{Ll})/u, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** «{{customer.greeting}}в чате…» без имени должно начинаться с «В чате…»; другие переменные не трогаем. */
function interpolateLine(template: string, vars: EmailTemplateVars, masked?: string[]): string {
  const out = interpolate(template, vars, masked);
  const lead = LEADING_PLACEHOLDER_RE.exec(template)?.[1];
  return lead && EMAIL_GREETING_KEYS.has(lead) && !varValue(vars, lead) ? capitalizeFirst(out) : out;
}

function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function linkify(text: string): string {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = m[0].replace(URL_TRAILING_PUNCT_RE, '');
    html += esc(text.slice(last, start)) + textLink(url, url);
    last = start + url.length;
  }
  return html + esc(text.slice(last));
}

/** `**жирный**` и ссылки; остальное экранируется. */
function inlineHtml(text: string): string {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part) => {
      const bold = /^\*\*([^*\n]+)\*\*$/.exec(part);
      return bold ? strong(bold[1]) : linkify(part);
    })
    .join('');
}

function stripBold(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
}

function snippetHtml(key: EmailSnippetKey, def: EmailNotificationEventDef, vars: EmailTemplateVars): string {
  switch (key) {
    case 'cta.button': {
      const href = varValue(vars, def.cta.urlKey);
      if (!href) return '';
      return button(def.cta.label, href) + (def.cta.withLinkFallback ? linkFallback(href) : '');
    }
    case 'block.quote': {
      const text = def.quote ? varValue(vars, def.quote.key) : '';
      return text ? quote(text) : '';
    }
    case 'block.details': {
      const rows = (def.details ?? [])
        .map((d) => ({ label: d.label, value: varValue(vars, d.key) }))
        .filter((r) => r.value);
      return rows.length ? details(rows) : '';
    }
  }
}

function snippetText(key: EmailSnippetKey, def: EmailNotificationEventDef, vars: EmailTemplateVars): string {
  switch (key) {
    case 'cta.button': {
      const href = varValue(vars, def.cta.urlKey);
      return href ? `${def.cta.label}: ${href}` : '';
    }
    case 'block.quote':
      return def.quote ? varValue(vars, def.quote.key) : '';
    case 'block.details':
      return (def.details ?? [])
        .map((d) => ({ label: d.label, value: varValue(vars, d.key) }))
        .filter((r) => r.value)
        .map((r) => `${r.label}: ${r.value}`)
        .join('\n');
  }
}

type BodySegment = { kind: 'text'; template: string } | { kind: 'snippet'; key: EmailSnippetKey };

/** Абзацы режем по шаблону, а не по результату — пустые строки внутри сообщения клиента не ломают вёрстку. */
function bodySegments(bodyTemplate: string): BodySegment[] {
  const segments: BodySegment[] = [];
  for (const block of bodyTemplate.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    let last = 0;
    for (const m of block.matchAll(PLACEHOLDER_RE)) {
      const key = m[1].trim();
      if (!isEmailSnippetKey(key)) continue;
      const idx = m.index ?? 0;
      const before = block.slice(last, idx);
      if (before.trim()) segments.push({ kind: 'text', template: before.trim() });
      segments.push({ kind: 'snippet', key });
      last = idx + m[0].length;
    }
    const rest = block.slice(last);
    if (rest.trim()) segments.push({ kind: 'text', template: rest.trim() });
  }
  return segments;
}

/** Абзац шаблона ровно из `{{<ссылка кнопки>}}` рисуется кнопкой. */
function isCtaUrlParagraph(template: string, def: EmailNotificationEventDef): boolean {
  return SOLE_PLACEHOLDER_RE.exec(template.trim())?.[1] === def.cta.urlKey;
}

/** `text` — с масками значений: переводы строк и маркеры списка в нём только от шаблона. */
function textBlockHtml(text: string, masked: string[]): string {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const html = lines.every((l) => BULLET_RE.test(l))
    ? bulletList(lines.map((l) => inlineHtml(l.replace(BULLET_RE, ''))))
    : paragraph(lines.map(inlineHtml).join('<br/>'));
  return unmaskHtml(html, masked);
}

export function renderEditableEmail(
  ctx: MailContext,
  def: EmailNotificationEventDef,
  tpl: EditableTemplate,
  rawVars: EmailTemplateVars,
): MailContent {
  const vars: EmailTemplateVars = { 'site.url': ctx.siteUrl, ...rawVars };
  const subject = flatten(interpolateLine(expandIfBlocks(tpl.subject, vars), vars)) || 'Wupapa';
  const title = flatten(interpolateLine(expandIfBlocks(tpl.title, vars), vars));
  const preheader = truncate(flatten(interpolate(def.preheader, vars)), 110) || subject;
  const eyebrow = flatten(interpolate(def.eyebrow, vars));

  const htmlBlocks: string[] = [];
  const textLines: string[] = [];
  for (const seg of bodySegments(expandIfBlocks(tpl.body, vars))) {
    const snippet = seg.kind === 'snippet' ? seg.key : isCtaUrlParagraph(seg.template, def) ? 'cta.button' : null;
    if (snippet) {
      const html = snippetHtml(snippet, def, vars);
      if (html) htmlBlocks.push(html);
      const text = snippetText(snippet, def, vars);
      if (text) textLines.push(text, '');
      continue;
    }
    if (seg.kind !== 'text') continue;
    const masked: string[] = [];
    const text = interpolateLine(seg.template, vars, masked).trim();
    if (!text) continue;
    htmlBlocks.push(textBlockHtml(text, masked));
    textLines.push(unmaskText(stripBold(text), masked), '');
  }
  if (textLines[textLines.length - 1] === '') textLines.pop();

  return {
    subject,
    html: renderLayout(ctx, {
      subject,
      preheader,
      eyebrow: eyebrow || undefined,
      title: title || subject,
      blocks: htmlBlocks,
      footerNote: def.footerNote,
    }),
    text: renderText(ctx, title ? [title, '', ...textLines] : textLines, def.footerNote),
  };
}

/** Письмо по текстам из реестра — резервная отправка и превью писем без правок. */
export function renderDefaultEmail(
  ctx: MailContext,
  def: EmailNotificationEventDef,
  vars: EmailTemplateVars,
): MailContent {
  return renderEditableEmail(ctx, def, defaultTemplate(def), vars);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1].trim());
}

function ifKeys(text: string): string[] {
  return [...text.matchAll(IF_BLOCK_RE)].map((m) => m[1].trim());
}

/** Сообщения для админа; пустой массив — шаблон можно сохранить. */
export function validateEditableTemplate(def: EmailNotificationEventDef, tpl: EditableTemplate): string[] {
  const errors: string[] = [];
  const known = new Set([...EMAIL_GLOBAL_VARIABLES, ...def.variables].map((v) => v.key));
  const optional = new Set(def.variables.filter((v) => v.optional).map((v) => v.key));
  const snippets = new Set<string>(eventSnippets(def).map((s) => s.key));

  const fields: { name: string; text: string; allowSnippets: boolean }[] = [
    { name: 'Тема', text: tpl.subject, allowSnippets: false },
    { name: 'Заголовок', text: tpl.title, allowSnippets: false },
    { name: 'Сообщение', text: tpl.body, allowSnippets: true },
  ];

  for (const f of fields) {
    if (!f.text.trim()) {
      errors.push(`${f.name}: заполните поле`);
      continue;
    }
    const unknown = new Set<string>();
    const misplacedSnippets = new Set<string>();
    for (const key of placeholders(f.text)) {
      if (isEmailSnippetKey(key)) {
        if (!f.allowSnippets) misplacedSnippets.add(key);
        else if (!snippets.has(key)) unknown.add(key);
        continue;
      }
      if (!known.has(key)) unknown.add(key);
    }
    if (unknown.size) {
      errors.push(`${f.name}: неизвестные переменные ${[...unknown].map((k) => `{{${k}}}`).join(', ')}`);
    }
    if (misplacedSnippets.size) {
      errors.push(
        `${f.name}: блоки ${[...misplacedSnippets].map((k) => `{{${k}}}`).join(', ')} можно вставлять только в сообщение`,
      );
    }

    const badIf = ifKeys(f.text).filter((k) => !optional.has(k));
    if (badIf.length) {
      errors.push(`${f.name}: условие нельзя ставить на ${[...new Set(badIf)].map((k) => `{{#if ${k}}}`).join(', ')}`);
    }
    const leftover = f.text.replace(IF_BLOCK_RE, '');
    if (/\{\{#if\b/.test(leftover) || /\{\{\/if\}\}/.test(leftover) || ifKeys(f.text).length !== countIfOpen(f.text)) {
      errors.push(`${f.name}: у каждого {{#if …}} должен быть свой {{/if}}, вложенные условия не поддерживаются`);
    }
  }
  if (tpl.body.trim() && !hasUnconditionalCta(tpl.body, def)) {
    errors.push(
      `Сообщение: нет кнопки «${def.cta.label}» — вставьте {{cta.button}} отдельным абзацем (не внутри {{#if}})`,
    );
  }
  return errors;
}

/** Без кнопки письмо бесполезно: действие клиента или сотрудника — единственная цель уведомления. */
function hasUnconditionalCta(body: string, def: EmailNotificationEventDef): boolean {
  return bodySegments(body.replace(IF_BLOCK_RE, '')).some(
    (seg) => (seg.kind === 'snippet' && seg.key === 'cta.button') || (seg.kind === 'text' && isCtaUrlParagraph(seg.template, def)),
  );
}

function countIfOpen(text: string): number {
  return (text.match(/\{\{#if\b/g) ?? []).length;
}
