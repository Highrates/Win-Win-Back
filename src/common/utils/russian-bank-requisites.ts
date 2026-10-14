/** Цифры из строки (ИНН / БИК / счёт). */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Контрольная сумма ИНН РФ (10 или 12 цифр).
 * @see https://ru.wikipedia.org/wiki/Идентификационный_номер_налогоплательщика
 */
export function isValidRussianInn(raw: string): boolean {
  const inn = digitsOnly(raw);
  if (inn.length === 10) {
    const n = inn.split('').map((c) => Number(c));
    const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const sum = weights.reduce((acc, w, i) => acc + w * n[i]!, 0);
    const check = (sum % 11) % 10;
    return check === n[9];
  }
  if (inn.length === 12) {
    const n = inn.split('').map((c) => Number(c));
    const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const c11 = (w11.reduce((acc, w, i) => acc + w * n[i]!, 0) % 11) % 10;
    const c12 = (w12.reduce((acc, w, i) => acc + w * n[i]!, 0) % 11) % 10;
    return c11 === n[10] && c12 === n[11];
  }
  return false;
}

/** БИК РФ — ровно 9 цифр. */
export function isValidRussianBic(raw: string): boolean {
  return /^\d{9}$/.test(digitsOnly(raw));
}

/**
 * Телефон РФ при непустом вводе: 10 цифр (9…) или 11 с префиксом 7/8.
 * Пустая строка — не проверяем (поле опционально).
 */
export function isValidRussianPhone(raw: string): boolean {
  const d = digitsOnly(raw);
  if (!d) return true;
  if (d.length === 10) return d.startsWith('9');
  if (d.length === 11) return d.startsWith('7') || d.startsWith('8');
  return false;
}

/**
 * Расчётный счёт (20 цифр) + БИК: контрольный ключ ЦБ РФ.
 * Если счёт пустой — не проверяем; если заполнен — нужны валидный БИК и ключ.
 */
export function isValidRussianBankAccount(accountRaw: string, bicRaw: string): boolean {
  const account = digitsOnly(accountRaw);
  const bic = digitsOnly(bicRaw);
  if (!account) return true;
  if (account.length !== 20 || !isValidRussianBic(bic)) return false;
  const bikTail = bic.slice(-3);
  const seq = `${bikTail}${account}`;
  const weights = [7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 23; i++) {
    sum += Number(seq[i]!) * weights[i]!;
  }
  return sum % 10 === 0;
}
