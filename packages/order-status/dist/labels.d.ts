import type { OrderStatusCode } from './constants';
export declare function orderStatusLabel(status: string, locale?: 'ru' | 'zh'): string;
/** Для проверки полноты подписей при изменении enum. */
export declare const ORDER_STATUS_CODES_WITH_LABELS: readonly OrderStatusCode[];
