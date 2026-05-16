import { OrderStatus } from '@prisma/client';

/** Жизненный цикл заказа после отправки из ЛК (порядок в UI). */
export const ORDER_STATUS_FLOW: readonly OrderStatus[] = [
  OrderStatus.PENDING_APPROVAL,
  OrderStatus.PROPOSAL_FORMED,
  OrderStatus.APPROVED,
  OrderStatus.PENDING_SIGNATURE,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PENDING_SHIPMENT,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED_TO_RU_WAREHOUSE,
  OrderStatus.RECEIVED,
  OrderStatus.COMPLETED,
];

export const CUSTOMER_IN_WORK_STATUSES: readonly OrderStatus[] = ORDER_STATUS_FLOW.filter(
  (s) => s !== OrderStatus.COMPLETED,
);

export const ADMIN_ACTIVE_STATUSES: readonly OrderStatus[] = ORDER_STATUS_FLOW.filter(
  (s) =>
    s !== OrderStatus.PENDING_APPROVAL &&
    s !== OrderStatus.COMPLETED &&
    s !== OrderStatus.RECEIVED,
);

export const ADMIN_COMPLETED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.RECEIVED,
  OrderStatus.COMPLETED,
];
