import { BadRequestException } from '@nestjs/common';

/**
 * Цифры страны и абонента без «+» (как в БД).
 * @throws BadRequestException при некорректном номере
 */
export function normalizePhoneE164(raw: string): string {
  const t = raw.trim();
  const digits = (t.startsWith('+') ? t.slice(1) : t).replace(/\D/g, '');
  if (digits.length < 10) throw new BadRequestException('Некорректный номер телефона');
  return digits;
}

/** E.164 для SMS-провайдера: + и только цифры. */
export function phoneDigitsToE164(digits: string): string {
  return `+${digits.replace(/\D/g, '')}`;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
