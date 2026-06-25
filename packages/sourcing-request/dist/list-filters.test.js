"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const list_filters_1 = require("./list-filters");
const status_1 = require("./status");
(0, vitest_1.describe)('adminBucketStatuses', () => {
    (0, vitest_1.it)('maps admin buckets', () => {
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)('new')).toEqual([status_1.SOURCING_STATUS.PENDING_REVIEW]);
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)('active')).toEqual([status_1.SOURCING_STATUS.IN_PROGRESS]);
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)('completed')).toEqual([
            status_1.SOURCING_STATUS.COMPLETED,
            status_1.SOURCING_STATUS.CANCELLED,
        ]);
    });
    (0, vitest_1.it)('returns undefined for unknown bucket', () => {
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)(undefined)).toBeUndefined();
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)('')).toBeUndefined();
        (0, vitest_1.expect)((0, list_filters_1.adminBucketStatuses)('archive')).toBeUndefined();
    });
});
(0, vitest_1.describe)('userScopeStatuses', () => {
    (0, vitest_1.it)('maps LK scopes', () => {
        (0, vitest_1.expect)((0, list_filters_1.userScopeStatuses)('work')).toEqual([
            status_1.SOURCING_STATUS.PENDING_REVIEW,
            status_1.SOURCING_STATUS.IN_PROGRESS,
        ]);
        (0, vitest_1.expect)((0, list_filters_1.userScopeStatuses)('completed')).toEqual([
            status_1.SOURCING_STATUS.COMPLETED,
            status_1.SOURCING_STATUS.CANCELLED,
        ]);
    });
    (0, vitest_1.it)('returns undefined for unknown scope', () => {
        (0, vitest_1.expect)((0, list_filters_1.userScopeStatuses)(undefined)).toBeUndefined();
        (0, vitest_1.expect)((0, list_filters_1.userScopeStatuses)('all')).toBeUndefined();
    });
});
