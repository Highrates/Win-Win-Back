"use strict";
/** Коды статусов заказа (Prisma `OrderStatus`, кроме REJECTED — вне жизненного цикла). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_COMPLETED_STATUSES = exports.ADMIN_ACTIVE_STATUSES = exports.CUSTOMER_IN_WORK_STATUSES = exports.CUSTOMER_IN_WORK_STATUSES_LIST = exports.KP_PUBLISH_ALLOWED_ORDER_STATUSES = exports.KP_PUBLISH_NEXT_STATUSES = exports.ORDER_STATUS_FLOW = exports.ORDER_STATUS_DRAFT = void 0;
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
/**
 * Следующий статус заказа при первой публикации КП из PENDING_APPROVAL.
 * Только согласование предложения / принятие — без прыжка в оплату/доставку/завершение.
 */
exports.KP_PUBLISH_NEXT_STATUSES = ['PROPOSAL_FORMED', 'APPROVED'];
/**
 * Статусы заказа, в которых разрешена публикация / republish КП.
 * С PENDING_SIGNATURE / PENDING_PAYMENT+ — нет (нельзя откатывать оплаченный/в пути заказ).
 */
exports.KP_PUBLISH_ALLOWED_ORDER_STATUSES = [
    'PENDING_APPROVAL',
    'PROPOSAL_FORMED',
    'APPROVED',
];
exports.CUSTOMER_IN_WORK_STATUSES_LIST = exports.ORDER_STATUS_FLOW.filter((s) => s !== 'COMPLETED');
/** Вкладка «В работе» в ЛК: не черновик и не завершён. */
exports.CUSTOMER_IN_WORK_STATUSES = new Set(exports.CUSTOMER_IN_WORK_STATUSES_LIST);
/** Админка: заказы в работе (после согласования, до завершения). */
exports.ADMIN_ACTIVE_STATUSES = exports.ORDER_STATUS_FLOW.filter((s) => s !== 'PENDING_APPROVAL' && s !== 'COMPLETED' && s !== 'RECEIVED');
exports.ADMIN_COMPLETED_STATUSES = ['RECEIVED', 'COMPLETED'];
