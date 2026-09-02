/** Детали ошибки nodemailer/SMTP для логов (в UI не отдаём). */
export function formatMailSendError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const ex = e as Error & { code?: string; responseCode?: number; response?: string; command?: string };
  const parts = [ex.message];
  if (ex.code) parts.push(`code=${ex.code}`);
  if (ex.command) parts.push(`cmd=${ex.command}`);
  if (ex.responseCode != null) parts.push(`smtp=${ex.responseCode}`);
  if (typeof ex.response === 'string' && ex.response.trim()) {
    parts.push(ex.response.trim().slice(0, 400));
  }
  return parts.join(' | ');
}

/** Детали SMS-провайдера для логов (в UI не отдаём). */
export function formatSmsSendError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return e.message;
}
