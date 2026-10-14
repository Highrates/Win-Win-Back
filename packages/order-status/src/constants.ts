/** Коды статусов заказа (Prisma `OrderStatus`, кроме REJECTED — вне жизненного цикла). */

export const ORDER_STATUS_DRAFT = 'DRAFT' as const;

/** Жизненный цикл после отправки из ЛК (порядок в UI). */
export const ORDER_STATUS_FLOW = [
  'PENDING_APPROVAL',
  'PROPOSAL_FORMED',
  'APPROVED',
  'PENDING_SIGNATURE',
  'PENDING_PAYMENT',
  'PAID',
  'PENDING_SHIPMENT',
  'IN_TRANSIT',
  'DELIVERED_TO_RU_WAREHOUSE',
  'RECEIVED',
  'COMPLETED',
] as const;

export type OrderStatusFlow = (typeof ORDER_STATUS_FLOW)[number];

export type OrderStatusCode = OrderStatusFlow | typeof ORDER_STATUS_DRAFT;

/**
 * Следующий статус заказа при первой публикации КП из PENDING_APPROVAL.
 * Только согласование предложения / принятие — без прыжка в оплату/доставку/завершение.
 */
export const KP_PUBLISH_NEXT_STATUSES = ['PROPOSAL_FORMED', 'APPROVED'] as const satisfies readonly OrderStatusFlow[];

export type KpPublishNextOrderStatus = (typeof KP_PUBLISH_NEXT_STATUSES)[number];

/**
 * Статусы заказа, в которых разрешена публикация / republish КП.
 * С PENDING_SIGNATURE / PENDING_PAYMENT+ — нет (нельзя откатывать оплаченный/в пути заказ).
 */
export const KP_PUBLISH_ALLOWED_ORDER_STATUSES = [
  'PENDING_APPROVAL',
  'PROPOSAL_FORMED',
  'APPROVED',
] as const satisfies readonly OrderStatusFlow[];

export type KpPublishAllowedOrderStatus = (typeof KP_PUBLISH_ALLOWED_ORDER_STATUSES)[number];

export const CUSTOMER_IN_WORK_STATUSES_LIST: readonly OrderStatusFlow[] = ORDER_STATUS_FLOW.filter(
  (s) => s !== 'COMPLETED',
);

/** Вкладка «В работе» в ЛК: не черновик и не завершён. */
export const CUSTOMER_IN_WORK_STATUSES = new Set<string>(CUSTOMER_IN_WORK_STATUSES_LIST);

/** Админка: заказы в работе (после согласования, до завершения). */
export const ADMIN_ACTIVE_STATUSES: readonly OrderStatusFlow[] = ORDER_STATUS_FLOW.filter(
  (s) => s !== 'PENDING_APPROVAL' && s !== 'COMPLETED' && s !== 'RECEIVED',
);

export const ADMIN_COMPLETED_STATUSES: readonly OrderStatusFlow[] = ['RECEIVED', 'COMPLETED'];
