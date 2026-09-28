/**
 * Рендер всех писем в HTML-файлы для просмотра в браузере:
 *   npm run email:preview
 * Результат: backend/.data/email-previews/index.html
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MAIL_PREVIEWS } from '../src/modules/auth/mail-previews';

const siteUrl = (process.env.FRONTEND_PUBLIC_URL || 'https://wupapa.ru').replace(/\/+$/, '');
const logoUrl = process.env.MAIL_LOGO_URL?.trim() || `${siteUrl}/email/wupapa-logo.png`;
const outDir = join(__dirname, '..', '.data', 'email-previews');

mkdirSync(outDir, { recursive: true });

const rows: string[] = [];
for (const preview of MAIL_PREVIEWS) {
  const mail = preview.render({ siteUrl, logoUrl });
  writeFileSync(join(outDir, `${preview.id}.html`), mail.html, 'utf8');
  writeFileSync(join(outDir, `${preview.id}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`, 'utf8');
  rows.push(
    `<tr><td>${preview.audience}</td><td>${preview.trigger}</td><td><a href="${preview.id}.html">${mail.subject}</a></td><td><a href="${preview.id}.txt">txt</a></td></tr>`,
  );
}

writeFileSync(
  join(outDir, 'index.html'),
  `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Письма Wupapa</title>
<style>body{font-family:system-ui,sans-serif;padding:32px;color:#1D1C1B}table{border-collapse:collapse}td{padding:8px 16px 8px 0;border-top:1px solid #e4e4e4}</style>
</head><body><h1>Письма Wupapa (${MAIL_PREVIEWS.length})</h1><table>${rows.join('')}</table></body></html>`,
  'utf8',
);

console.log(`Готово: ${join(outDir, 'index.html')}`);
