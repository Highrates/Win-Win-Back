import { OrderStatus } from '@prisma/client';
import {
  ADMIN_ACTIVE_STATUSES as ADMIN_ACTIVE_FLOW,
  ADMIN_COMPLETED_STATUSES as ADMIN_COMPLETED_FLOW,
  CUSTOMER_IN_WORK_STATUSES_LIST,
  ORDER_STATUS_FLOW as ORDER_STATUS_FLOW_SHARED,
} from '@win-win/order-status';

/** Жизненный цикл заказа после отправки из ЛК (порядок в UI). */
export const ORDER_STATUS_FLOW = ORDER_STATUS_FLOW_SHARED as readonly OrderStatus[];

export const CUSTOMER_IN_WORK_STATUSES: readonly OrderStatus[] =
  CUSTOMER_IN_WORK_STATUSES_LIST as readonly OrderStatus[];

export const ADMIN_ACTIVE_STATUSES: readonly OrderStatus[] =
  ADMIN_ACTIVE_FLOW as readonly OrderStatus[];

export const ADMIN_COMPLETED_STATUSES: readonly OrderStatus[] =
  ADMIN_COMPLETED_FLOW as readonly OrderStatus[];
