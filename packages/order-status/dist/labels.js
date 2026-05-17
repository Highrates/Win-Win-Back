"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_STATUS_CODES_WITH_LABELS = void 0;
exports.orderStatusLabel = orderStatusLabel;
const constants_1 = require("./constants");
const LABELS_RU = {
    DRAFT: 'Черновик',
    PENDING_APPROVAL: 'На согласовании',
    PROPOSAL_FORMED: 'Предложение сформировано',
    APPROVED: 'Согласовано',
    PENDING_SIGNATURE: 'Ожидает подписи',
    PENDING_PAYMENT: 'Ожидает оплаты',
    PAID: 'Оплачено',
    PENDING_SHIPMENT: 'Ожидает отгрузки',
    IN_TRANSIT: 'В пути',
    DELIVERED_TO_RU_WAREHOUSE: 'Доставлен на склад в РФ',
    RECEIVED: 'Получено',
    COMPLETED: 'Завершен',
};
const LABELS_ZH = {
    DRAFT: '草稿',
    PENDING_APPROVAL: '待审批',
    PROPOSAL_FORMED: '方案已生成',
    APPROVED: '已批准',
    PENDING_SIGNATURE: '待签署',
    PENDING_PAYMENT: '待付款',
    PAID: '已付款',
    PENDING_SHIPMENT: '待发货',
    IN_TRANSIT: '运输中',
    DELIVERED_TO_RU_WAREHOUSE: '已送达俄罗斯仓库',
    RECEIVED: '已收货',
    COMPLETED: '已完成',
};
function orderStatusLabel(status, locale = 'ru') {
    const map = locale === 'zh' ? LABELS_ZH : LABELS_RU;
    const key = status;
    if (key in map)
        return map[key];
    return status;
}
/** Для проверки полноты подписей при изменении enum. */
exports.ORDER_STATUS_CODES_WITH_LABELS = [
    constants_1.ORDER_STATUS_DRAFT,
    ...constants_1.ORDER_STATUS_FLOW,
];
