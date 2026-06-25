import { type SourcingRequestStatusCode } from './status';
/** Админка: bucket query → статусы Prisma. */
export declare function adminBucketStatuses(bucket: string | undefined): readonly SourcingRequestStatusCode[] | undefined;
/** ЛК: scope query → статусы Prisma. */
export declare function userScopeStatuses(scope: string | undefined): readonly SourcingRequestStatusCode[] | undefined;
