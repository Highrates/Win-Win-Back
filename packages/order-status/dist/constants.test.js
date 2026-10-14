"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const constants_1 = require("./constants");
(0, vitest_1.describe)('ORDER_STATUS_FLOW', () => {
    (0, vitest_1.it)('matches expected lifecycle length', () => {
        (0, vitest_1.expect)(constants_1.ORDER_STATUS_FLOW).toHaveLength(11);
    });
    (0, vitest_1.it)('KP publish next status — только PROPOSAL_FORMED / APPROVED', () => {
        (0, vitest_1.expect)([...constants_1.KP_PUBLISH_NEXT_STATUSES]).toEqual(['PROPOSAL_FORMED', 'APPROVED']);
        (0, vitest_1.expect)(constants_1.KP_PUBLISH_NEXT_STATUSES).not.toContain('COMPLETED');
        (0, vitest_1.expect)(constants_1.KP_PUBLISH_NEXT_STATUSES).not.toContain('PENDING_PAYMENT');
    });
    (0, vitest_1.it)('KP publish allowed order statuses — до оплаты', () => {
        (0, vitest_1.expect)([...constants_1.KP_PUBLISH_ALLOWED_ORDER_STATUSES]).toEqual([
            'PENDING_APPROVAL',
            'PROPOSAL_FORMED',
            'APPROVED',
        ]);
        (0, vitest_1.expect)(constants_1.KP_PUBLISH_ALLOWED_ORDER_STATUSES).not.toContain('PENDING_PAYMENT');
        (0, vitest_1.expect)(constants_1.KP_PUBLISH_ALLOWED_ORDER_STATUSES).not.toContain('PAID');
    });
    (0, vitest_1.it)('admin buckets are disjoint subsets of flow', () => {
        for (const s of constants_1.ADMIN_ACTIVE_STATUSES) {
            (0, vitest_1.expect)(constants_1.ORDER_STATUS_FLOW).toContain(s);
        }
        for (const s of constants_1.ADMIN_COMPLETED_STATUSES) {
            (0, vitest_1.expect)(constants_1.ORDER_STATUS_FLOW).toContain(s);
        }
        (0, vitest_1.expect)(constants_1.CUSTOMER_IN_WORK_STATUSES_LIST).not.toContain('COMPLETED');
    });
});
