import { SOURCING_STATUS, type SourcingRequestStatusCode } from './status';

/** Админка: bucket query → статусы Prisma. */
export function adminBucketStatuses(bucket: string | undefined): readonly SourcingRequestStatusCode[] | undefined {
  const b = bucket?.trim();
  if (b === 'new') return [SOURCING_STATUS.PENDING_REVIEW];
  if (b === 'active') return [SOURCING_STATUS.IN_PROGRESS];
  if (b === 'completed') return [SOURCING_STATUS.COMPLETED, SOURCING_STATUS.CANCELLED];
  return undefined;
}

/** ЛК: scope query → статусы Prisma. */
export function userScopeStatuses(scope: string | undefined): readonly SourcingRequestStatusCode[] | undefined {
  const s = scope?.trim();
  if (s === 'work') return [SOURCING_STATUS.PENDING_REVIEW, SOURCING_STATUS.IN_PROGRESS];
  if (s === 'completed') return [SOURCING_STATUS.COMPLETED, SOURCING_STATUS.CANCELLED];
  return undefined;
}
