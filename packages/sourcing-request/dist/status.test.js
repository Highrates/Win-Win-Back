"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const status_1 = require("./status");
(0, vitest_1.describe)('SOURCING_STATUS_TRANSITIONS FSM', () => {
    (0, vitest_1.it)('allows documented transitions', () => {
        for (const [from, targets] of Object.entries(status_1.SOURCING_STATUS_TRANSITIONS)) {
            for (const to of targets) {
                (0, vitest_1.expect)((0, status_1.isAllowedSourcingStatusTransition)(from, to)).toBe(true);
                (0, vitest_1.expect)(() => (0, status_1.assertSourcingStatusTransition)(from, to)).not.toThrow();
            }
        }
    });
    (0, vitest_1.it)('allows same status', () => {
        for (const status of Object.values(status_1.SOURCING_STATUS)) {
            (0, vitest_1.expect)(() => (0, status_1.assertSourcingStatusTransition)(status, status)).not.toThrow();
        }
    });
    (0, vitest_1.it)('blocks illegal jumps', () => {
        (0, vitest_1.expect)(() => (0, status_1.assertSourcingStatusTransition)(status_1.SOURCING_STATUS.COMPLETED, status_1.SOURCING_STATUS.IN_PROGRESS)).toThrow(/Нельзя перевести заявку/);
        (0, vitest_1.expect)(() => (0, status_1.assertSourcingStatusTransition)(status_1.SOURCING_STATUS.PENDING_REVIEW, status_1.SOURCING_STATUS.COMPLETED)).toThrow(/Нельзя перевести заявку/);
    });
});
