export type OrderItemSnapshotMetaRow = { label: string; value: string };

/** Подписи колонок для строки «модификация / элементы» из `OrderItem.snapshot` (JSON). */
export type OrderItemSnapshotMetaLabels = {
  /** По умолчанию: «Модификация» */
  modification?: string;
  /** Подпись строки элемента, если `elementLabel` пустой. По умолчанию: «Элемент» */
  elementFallback?: string;
};

function asRecord(snapshot: unknown): Record<string, unknown> | null {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return snapshot as Record<string, unknown>;
  }
  return null;
}

/**
 * Единый разбор `snapshot` позиции заказа (как на PDP / в подготовке заказа) → строки для UI.
 */
export function orderItemSnapshotMetaRows(
  snapshot: unknown,
  labels: OrderItemSnapshotMetaLabels = {},
): OrderItemSnapshotMetaRow[] {
  const s = asRecord(snapshot);
  if (!s) return [];
  const modLabel = (labels.modification?.trim() || 'Модификация').trim();
  const elFallback = (labels.elementFallback?.trim() || 'Элемент').trim();
  const rows: OrderItemSnapshotMetaRow[] = [];
  const mod = s.modificationLabel;
  if (typeof mod === 'string' && mod.trim()) {
    rows.push({ label: modLabel, value: mod.trim() });
  }
  const em = s.elementMaterialRows;
  if (Array.isArray(em)) {
    for (const row of em) {
      if (row && typeof row === 'object' && 'elementLabel' in row && 'materialColorLabel' in row) {
        const el = (row as { elementLabel?: unknown }).elementLabel;
        const mat = (row as { materialColorLabel?: unknown }).materialColorLabel;
        if (typeof el === 'string' && typeof mat === 'string') {
          rows.push({ label: el.trim() || elFallback, value: mat.trim() || '—' });
        }
      }
    }
  }
  return rows;
}
