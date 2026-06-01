/**
 * Цифры страны и абонента без «+» — как в БД после регистрации (`RegistrationService.normalizePhoneE164`).
 * Для lookup/login: не бросает, возвращает '' если цифр нет или ввод похож на email.
 */
export function normalizePhoneDigitsForLookup(raw: string): string {
  const t = raw.trim();
  if (!t || t.includes('@')) return '';
  return (t.startsWith('+') ? t.slice(1) : t).replace(/\D/g, '');
}

/** Email или нормализованный телефон для `findByEmailOrPhone`. */
export function normalizeEmailOrPhoneForLookup(raw: string): { kind: 'email'; value: string } | { kind: 'phone'; value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    return { kind: 'email', value: trimmed.toLowerCase() };
  }
  const digits = normalizePhoneDigitsForLookup(trimmed);
  if (digits.length < 10) return null;
  return { kind: 'phone', value: digits };
}
