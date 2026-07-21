/** Парсинг query-параметров фильтров каталога и Meilisearch-фрагменты. */

export function parseCsvIds(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseFlagParam(raw: string | undefined | null): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Парсит `sizeFrom` / `sizeTo` → неотрицательное число или undefined. */
export function parseSizeBound(raw: number | string | undefined | null): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export function escapeMeilisearchString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** `attr = "a" OR attr = "b"` (для массивов и скаляров Meili). */
export function meilisearchOrEquals(attr: string, values: string[]): string | null {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return null;
  if (vals.length === 1) return `${attr} = "${escapeMeilisearchString(vals[0]!)}"`;
  return `(${vals.map((v) => `${attr} = "${escapeMeilisearchString(v)}"`).join(' OR ')})`;
}
