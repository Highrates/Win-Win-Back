/**
 * CORS для Socket.IO namespace order-chat.
 * - **development:** `origin: true` (отражение Origin клиента) — удобно при localhost и разных портах.
 * - **production:** обязательна непустая whitelist в **`ORDER_CHAT_SOCKET_CORS_ORIGINS`** после парсинга;
 *   иначе процесс падает при старте. Аварийно: **`ORDER_CHAT_SOCKET_CORS_RELAXED=1`** → permissive (`origin: true`) + предупреждение в лог.
 */

function parseCommaSeparatedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      out.push(new URL(s).origin);
    } catch {
      /* пропуск невалидного элемента */
    }
  }
  return [...new Set(out)];
}

function envFlagTrue(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function getOrderChatWebSocketCorsOptions(): { origin: boolean | string[]; credentials: true } {
  const credentials = true as const;
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

  const explicit = parseCommaSeparatedOrigins(process.env.ORDER_CHAT_SOCKET_CORS_ORIGINS);
  if (explicit.length > 0) {
    if (isProd) {
      for (const o of explicit) {
        if (o.startsWith('http://')) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Win-Win][order-chat WS] NODE_ENV=production: origin whitelist contains HTTP (${o}); для публичного сайта предпочтителен HTTPS.`,
          );
        }
      }
    }
    return { origin: explicit, credentials };
  }

  if (!isProd) {
    return { origin: true, credentials };
  }

  if (envFlagTrue('ORDER_CHAT_SOCKET_CORS_RELAXED')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Win-Win][order-chat WS] ORDER_CHAT_SOCKET_CORS_RELAXED включён: permissive CORS (origin: true). ' +
        'После восстановления ORDER_CHAT_SOCKET_CORS_ORIGINS снимите флаг.',
    );
    return { origin: true, credentials };
  }

  throw new Error(
    '[Win-Win][order-chat WS] NODE_ENV=production и пустой ORDER_CHAT_SOCKET_CORS_ORIGINS: задайте whitelist ' +
      '(через запятую, полные URL без завершающего /, например https://site.ru,https://www.site.ru). ' +
      'Origin должен совпадать с тем, с которого браузер открыл Next (см. DevTools → Network → заголовок Origin на запросе к /socket.io/). ' +
      'Аварийный откат (небезопасно): ORDER_CHAT_SOCKET_CORS_RELAXED=1.',
  );
}
