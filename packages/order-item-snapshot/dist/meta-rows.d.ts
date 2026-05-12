export type OrderItemSnapshotMetaRow = {
    label: string;
    value: string;
};
/** Подписи колонок для строки «модификация / элементы» из `OrderItem.snapshot` (JSON). */
export type OrderItemSnapshotMetaLabels = {
    /** По умолчанию: «Модификация» */
    modification?: string;
    /** Подпись строки элемента, если `elementLabel` пустой. По умолчанию: «Элемент» */
    elementFallback?: string;
};
/**
 * Единый разбор `snapshot` позиции заказа (как на PDP / в подготовке заказа) → строки для UI.
 */
export declare function orderItemSnapshotMetaRows(snapshot: unknown, labels?: OrderItemSnapshotMetaLabels): OrderItemSnapshotMetaRow[];
