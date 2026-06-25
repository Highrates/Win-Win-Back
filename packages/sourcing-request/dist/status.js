"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourcingStatusTransitionError = exports.SOURCING_STATUS_LABELS = exports.SOURCING_STATUS_TRANSITIONS = exports.SOURCING_STATUS = void 0;
exports.isAllowedSourcingStatusTransition = isAllowedSourcingStatusTransition;
exports.assertSourcingStatusTransition = assertSourcingStatusTransition;
exports.SOURCING_STATUS = {
    PENDING_REVIEW: 'PENDING_REVIEW',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
};
/** Допустимые переходы статуса заявки на подбор (FSM). */
exports.SOURCING_STATUS_TRANSITIONS = {
    PENDING_REVIEW: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};
exports.SOURCING_STATUS_LABELS = {
    PENDING_REVIEW: 'На рассмотрении',
    IN_PROGRESS: 'В работе',
    COMPLETED: 'Завершена',
    CANCELLED: 'Отменена',
};
function isAllowedSourcingStatusTransition(from, to) {
    if (from === to)
        return true;
    return exports.SOURCING_STATUS_TRANSITIONS[from].includes(to);
}
class SourcingStatusTransitionError extends Error {
    constructor(from, to) {
        super(`Нельзя перевести заявку из «${exports.SOURCING_STATUS_LABELS[from]}» в «${exports.SOURCING_STATUS_LABELS[to]}»`);
        this.name = 'SourcingStatusTransitionError';
        this.from = from;
        this.to = to;
    }
}
exports.SourcingStatusTransitionError = SourcingStatusTransitionError;
function assertSourcingStatusTransition(from, to) {
    if (!isAllowedSourcingStatusTransition(from, to)) {
        throw new SourcingStatusTransitionError(from, to);
    }
}
