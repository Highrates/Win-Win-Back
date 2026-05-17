/** Коды статусов заказа (Prisma `OrderStatus`, кроме REJECTED — вне жизненного цикла). */
export declare const ORDER_STATUS_DRAFT: "DRAFT";
/** Жизненный цикл после отправки из ЛК (порядок в UI). */
export declare const ORDER_STATUS_FLOW: readonly ["PENDING_APPROVAL", "PROPOSAL_FORMED", "APPROVED", "PENDING_SIGNATURE", "PENDING_PAYMENT", "PAID", "PENDING_SHIPMENT", "IN_TRANSIT", "DELIVERED_TO_RU_WAREHOUSE", "RECEIVED", "COMPLETED"];
export type OrderStatusFlow = (typeof ORDER_STATUS_FLOW)[number];
export type OrderStatusCode = OrderStatusFlow | typeof ORDER_STATUS_DRAFT;
/** Следующий статус заказа при публикации КП (после «На согласовании»). */
export declare const KP_PUBLISH_NEXT_STATUSES: readonly Exclude<OrderStatusFlow, "PENDING_APPROVAL">[];
export type KpPublishNextOrderStatus = (typeof KP_PUBLISH_NEXT_STATUSES)[number];
export declare const CUSTOMER_IN_WORK_STATUSES_LIST: readonly OrderStatusFlow[];
/** Вкладка «В работе» в ЛК: не черновик и не завершён. */
export declare const CUSTOMER_IN_WORK_STATUSES: Set<string>;
/** Админка: заказы в работе (после согласования, до завершения). */
export declare const ADMIN_ACTIVE_STATUSES: readonly OrderStatusFlow[];
export declare const ADMIN_COMPLETED_STATUSES: readonly OrderStatusFlow[];
