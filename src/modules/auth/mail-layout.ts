/**
 * Вёрстка писем в стилистике сайта (токены из frontend/app/globals.css).
 * Только таблицы и inline-стили — так письма одинаково выглядят в Gmail, Яндекс, Mail.ru, Outlook и Apple Mail.
 */

export type MailContent = { subject: string; text: string; html: string };

export type MailContext = {
  /** Публичный origin сайта без завершающего `/` */
  siteUrl: string;
  /** PNG логотипа с пропорциями 444×60 (SVG почтовики не показывают); без него — текстовый логотип. */
  logoUrl?: string | null;
  now?: Date;
};

const FONT = "'Commissioner','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
const INK = '#1D1C1B';
const GRAY = '#9D9D9D';
const SNOW = '#F6F6F6';
const HAIRLINE = '#E4E4E4';
const WHITE = '#FFFFFF';

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function strong(value: string): string {
  return `<strong style="font-weight:500;color:${INK};">${esc(value)}</strong>`;
}

/** `html` — уже безопасная разметка (собирайте через `esc` / `strong`). */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:300;color:${INK};">${html}</p>`;
}

export function note(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:300;color:${GRAY};">${html}</p>`;
}

export function button(label: string, href: string): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">`,
    `<tr><td bgcolor="${INK}" style="border-radius:100px;background:${INK};">`,
    `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:18px;font-weight:400;color:${WHITE};text-decoration:none;border-radius:100px;">${esc(label)}</a>`,
    `</td></tr></table>`,
  ].join('');
}

export function linkFallback(href: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:300;color:${GRAY};">Кнопка не открывается? Скопируйте ссылку в браузер:<br/><a href="${esc(href)}" target="_blank" style="color:${GRAY};text-decoration:underline;word-break:break-all;">${esc(href)}</a></p>`;
}

export function textLink(label: string, href: string): string {
  return `<a href="${esc(href)}" target="_blank" style="color:${INK};text-decoration:underline;">${esc(label)}</a>`;
}

export function codeBox(code: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">`,
    `<tr><td align="center" style="background:${SNOW};border-radius:8px;padding:24px 12px;">`,
    `<span class="wp-code" style="display:inline-block;padding-left:12px;font-family:${FONT};font-size:36px;line-height:40px;font-weight:400;letter-spacing:12px;color:${INK};">${esc(code)}</span>`,
    `</td></tr></table>`,
  ].join('');
}

export function quote(text: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">`,
    `<tr><td style="background:${SNOW};border-radius:8px;padding:16px 20px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:300;color:${INK};white-space:pre-wrap;word-break:break-word;">${esc(text)}</td></tr>`,
    `</table>`,
  ].join('');
}

/** `items` — уже безопасная разметка строк. */
export function bulletList(items: string[]): string {
  const rows = items
    .map(
      (html) =>
        `<tr><td width="20" style="padding:0 0 8px;vertical-align:top;font-family:${FONT};font-size:15px;line-height:22px;font-weight:300;color:${GRAY};">•</td><td style="padding:0 0 8px;vertical-align:top;font-family:${FONT};font-size:15px;line-height:22px;font-weight:300;color:${INK};">${html}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${rows}</table>`;
}

export type DetailRow = { label: string; value: string; mono?: boolean };

export function details(rows: DetailRow[]): string {
  const cells = rows
    .map((row, i) => {
      const last = i === rows.length - 1;
      const border = `border-top:1px solid ${HAIRLINE};${last ? `border-bottom:1px solid ${HAIRLINE};` : ''}`;
      const valueFont = row.mono ? `font-family:${MONO};font-size:14px;` : `font-family:${FONT};font-size:15px;`;
      return [
        `<tr>`,
        `<td style="${border}padding:12px 16px 12px 0;vertical-align:top;font-family:${FONT};font-size:14px;line-height:20px;font-weight:300;color:${GRAY};white-space:nowrap;">${esc(row.label)}</td>`,
        `<td align="right" style="${border}padding:12px 0;vertical-align:top;${valueFont}line-height:20px;font-weight:400;color:${INK};text-align:right;word-break:break-word;">${esc(row.value)}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;border-collapse:collapse;">${cells}</table>`;
}

export type LayoutParams = {
  subject: string;
  /** Строка-превью в списке писем почтового клиента */
  preheader: string;
  /** Мелкая строка над заголовком: «Заказ 1a2b…9f0e», «Безопасность» */
  eyebrow?: string;
  title: string;
  /** Безопасная разметка блоков (`paragraph`, `button`, `details`…) */
  blocks: string[];
  /** Почему пришло письмо / что делать, если не ждали */
  footerNote: string;
};

function siteHost(siteUrl: string): string {
  return siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function renderLayout(ctx: MailContext, p: LayoutParams): string {
  const site = ctx.siteUrl.replace(/\/+$/, '');
  const year = (ctx.now ?? new Date()).getFullYear();
  const logo = ctx.logoUrl
    ? `<img src="${esc(ctx.logoUrl)}" width="148" height="20" alt="WUPAPA" style="display:block;width:148px;height:20px;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:16px;line-height:20px;letter-spacing:6px;color:${INK};" />`
    : `<span style="font-family:${FONT};font-size:20px;line-height:20px;font-weight:400;letter-spacing:7px;color:${INK};">WUPAPA</span>`;
  const eyebrow = p.eyebrow
    ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:16px;font-weight:300;color:${GRAY};">${esc(p.eyebrow)}</p>`
    : '';
  const preheaderPad = '&#8203;&nbsp;'.repeat(60);

  return [
    `<!DOCTYPE html>`,
    `<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width,initial-scale=1" />`,
    `<meta name="color-scheme" content="light" />`,
    `<meta name="supported-color-schemes" content="light" />`,
    `<title>${esc(p.subject)}</title>`,
    `<link href="https://fonts.googleapis.com/css2?family=Commissioner:wght@300;400;500&amp;display=swap" rel="stylesheet" />`,
    `<style>`,
    `body{margin:0;padding:0;background:${SNOW};-webkit-text-size-adjust:100%;}`,
    `a{color:${INK};}`,
    `@media (max-width:600px){`,
    `.wp-outer{padding:20px 12px !important;}`,
    `.wp-card{padding:28px 20px !important;}`,
    `.wp-title{font-size:22px !important;line-height:28px !important;}`,
    `.wp-code{font-size:30px !important;letter-spacing:8px !important;padding-left:8px !important;}`,
    `}`,
    `</style>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${SNOW};">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${SNOW};">${esc(p.preheader)}${preheaderPad}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SNOW};">`,
    `<tr><td align="center" class="wp-outer" style="padding:40px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">`,
    `<tr><td style="padding:0 4px 24px;"><a href="${esc(site)}" target="_blank" style="text-decoration:none;color:${INK};">${logo}</a></td></tr>`,
    `<tr><td class="wp-card" style="background:${WHITE};border-radius:8px;padding:40px;">`,
    eyebrow,
    `<h1 class="wp-title" style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:300;color:${INK};">${esc(p.title)}</h1>`,
    ...p.blocks,
    `</td></tr>`,
    `<tr><td style="padding:24px 4px 0;">`,
    `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:300;color:${GRAY};">${esc(p.footerNote)}</p>`,
    `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:300;color:${GRAY};">© ${year} Wupapa · <a href="${esc(site)}" target="_blank" style="color:${GRAY};text-decoration:underline;">${esc(siteHost(site))}</a></p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}

export function renderText(ctx: MailContext, lines: string[], footerNote: string): string {
  return [...lines, '', '—', footerNote, `Wupapa · ${siteHost(ctx.siteUrl)}`].join('\n');
}
