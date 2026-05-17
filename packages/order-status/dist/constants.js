"use strict";
/** Коды статусов заказа (Prisma `OrderStatus`, кроме REJECTED — вне жизненного цикла). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_COMPLETED_STATUSES = exports.ADMIN_ACTIVE_STATUSES = exports.CUSTOMER_IN_WORK_STATUSES = exports.CUSTOMER_IN_WORK_STATUSES_LIST = exports.KP_PUBLISH_NEXT_STATUSES = exports.ORDER_STATUS_FLOW = exports.ORDER_STATUS_DRAFT = void 0;
exports.ORDER_STATUS_DRAFT = 'DRAFT';
/** Жизненный цикл после отправки из ЛК (порядок в UI). */
exports.ORDER_STATUS_FLOW = [
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
];
/** Следующий статус заказа при публикации КП (после «На согласовании»). */
exports.KP_PUBLISH_NEXT_STATUSES = exports.ORDER_STATUS_FLOW.filter((s) => s !== 'PENDING_APPROVAL');
exports.CUSTOMER_IN_WORK_STATUSES_LIST = exports.ORDER_STATUS_FLOW.filter((s) => s !== 'COMPLETED');
/** Вкладка «В работе» в ЛК: не черновик и не завершён. */
exports.CUSTOMER_IN_WORK_STATUSES = new Set(exports.CUSTOMER_IN_WORK_STATUSES_LIST);
/** Админка: заказы в работе (после согласования, до завершения). */
exports.ADMIN_ACTIVE_STATUSES = exports.ORDER_STATUS_FLOW.filter((s) => s !== 'PENDING_APPROVAL' && s !== 'COMPLETED' && s !== 'RECEIVED');
exports.ADMIN_COMPLETED_STATUSES = ['RECEIVED', 'COMPLETED'];
