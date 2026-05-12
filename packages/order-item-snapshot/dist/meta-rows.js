"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderItemSnapshotMetaRows = orderItemSnapshotMetaRows;
function asRecord(snapshot) {
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        return snapshot;
    }
    return null;
}
/**
 * Единый разбор `snapshot` позиции заказа (как на PDP / в подготовке заказа) → строки для UI.
 */
function orderItemSnapshotMetaRows(snapshot, labels = {}) {
    const s = asRecord(snapshot);
    if (!s)
        return [];
    const modLabel = (labels.modification?.trim() || 'Модификация').trim();
    const elFallback = (labels.elementFallback?.trim() || 'Элемент').trim();
    const rows = [];
    const mod = s.modificationLabel;
    if (typeof mod === 'string' && mod.trim()) {
        rows.push({ label: modLabel, value: mod.trim() });
    }
    const em = s.elementMaterialRows;
    if (Array.isArray(em)) {
        for (const row of em) {
            if (row && typeof row === 'object' && 'elementLabel' in row && 'materialColorLabel' in row) {
                const el = row.elementLabel;
                const mat = row.materialColorLabel;
                if (typeof el === 'string' && typeof mat === 'string') {
                    rows.push({ label: el.trim() || elFallback, value: mat.trim() || '—' });
                }
            }
        }
    }
    return rows;
}
