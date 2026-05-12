export type OrderItemSnapshotMetaRow = {
    label: string;
    value: string;
};
export type OrderItemSnapshotMetaLabels = {
    modification?: string;
    elementFallback?: string;
};
export declare function orderItemSnapshotMetaRows(snapshot: unknown, labels?: OrderItemSnapshotMetaLabels): OrderItemSnapshotMetaRow[];
