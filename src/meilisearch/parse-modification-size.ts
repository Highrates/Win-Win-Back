/**
 * Размер из названия модификации.
 * Берём часть до « · » (текст после средней точки отбрасываем).
 * Оставляем подписи с единицей см / мм / м, либо чистые габариты «2400x1200» / «2400 × 1200».
 */
export function parseModificationSizeLabel(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const sizePart = (trimmed.split(/\s*·\s*/u)[0] ?? '').trim();
  if (!sizePart || !/\d/.test(sizePart)) return null;
  // см / мм / м как единица измерения (не часть другого слова)
  if (/(?:см|мм)(?:\s|$)/u.test(sizePart) || /(?:^|[\s\d,])м(?:\s|$)/u.test(sizePart)) {
    return sizePart;
  }
  // «2400x1200», «2400 × 1200 × 800» без единицы
  if (/^\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,2}$/iu.test(sizePart)) {
    return sizePart;
  }
  return null;
}

/** Первое число в подписи размера (для фильтра От/До). */
export function firstSizeNumber(label: string): number | null {
  const m = label.match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function sizeLabelMatchesRange(
  label: string,
  from?: number,
  to?: number,
): boolean {
  if (from == null && to == null) return true;
  const n = firstSizeNumber(label);
  if (n == null) return false;
  if (from != null && n < from) return false;
  if (to != null && n > to) return false;
  return true;
}
