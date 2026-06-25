"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminBucketStatuses = adminBucketStatuses;
exports.userScopeStatuses = userScopeStatuses;
const status_1 = require("./status");
/** Админка: bucket query → статусы Prisma. */
function adminBucketStatuses(bucket) {
    const b = bucket?.trim();
    if (b === 'new')
        return [status_1.SOURCING_STATUS.PENDING_REVIEW];
    if (b === 'active')
        return [status_1.SOURCING_STATUS.IN_PROGRESS];
    if (b === 'completed')
        return [status_1.SOURCING_STATUS.COMPLETED, status_1.SOURCING_STATUS.CANCELLED];
    return undefined;
}
/** ЛК: scope query → статусы Prisma. */
function userScopeStatuses(scope) {
    const s = scope?.trim();
    if (s === 'work')
        return [status_1.SOURCING_STATUS.PENDING_REVIEW, status_1.SOURCING_STATUS.IN_PROGRESS];
    if (s === 'completed')
        return [status_1.SOURCING_STATUS.COMPLETED, status_1.SOURCING_STATUS.CANCELLED];
    return undefined;
}
