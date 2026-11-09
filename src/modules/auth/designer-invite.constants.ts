/** Срок действия ссылки приглашения дизайнера-партнёра. */
export const DESIGNER_INVITE_TTL_DAYS = 14;
export const DESIGNER_INVITE_TTL_JWT = `${DESIGNER_INVITE_TTL_DAYS}d` as const;
export const DESIGNER_INVITE_TTL_LABEL = `${DESIGNER_INVITE_TTL_DAYS} дней`;

/** Суточный лимит отправок одним дизайнером-партнёром. */
export const DESIGNER_INVITE_DAILY_LIMIT = 80;

/** Защита от всплеска: не больше N приглашений за окно. */
export const DESIGNER_INVITE_BURST_LIMIT = 10;
export const DESIGNER_INVITE_BURST_WINDOW_MS = 15 * 60 * 1000;

/** Терминология в пользовательских текстах. */
export const DESIGNER_PARTNER_LABEL = 'дизайнер-партнёр Wupapa';
/** Имя в письме/UI, если у пригласившего нет имени и email. */
export const DESIGNER_PARTNER_FALLBACK_NAME = 'Партнёр Wupapa';
export const WINWIN_PROGRAM_LABEL = 'программа Win‑Win';

/** Сколько последних приглашений отдаём в списке ЛК. */
export const DESIGNER_INVITE_LIST_LIMIT = 50;

/** Коды ошибок invite-flow (фронт классифицирует по code, не по тексту). */
export const DESIGNER_INVITE_ERROR_CODE = {
  INVALID: 'invite_invalid',
  MISMATCH: 'invite_mismatch',
} as const;

export type DesignerInviteErrorCode =
  (typeof DESIGNER_INVITE_ERROR_CODE)[keyof typeof DESIGNER_INVITE_ERROR_CODE];
