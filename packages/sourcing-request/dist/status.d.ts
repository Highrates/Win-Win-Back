export declare const SOURCING_STATUS: {
    readonly PENDING_REVIEW: "PENDING_REVIEW";
    readonly IN_PROGRESS: "IN_PROGRESS";
    readonly COMPLETED: "COMPLETED";
    readonly CANCELLED: "CANCELLED";
};
export type SourcingRequestStatusCode = (typeof SOURCING_STATUS)[keyof typeof SOURCING_STATUS];
/** Допустимые переходы статуса заявки на подбор (FSM). */
export declare const SOURCING_STATUS_TRANSITIONS: Readonly<Record<SourcingRequestStatusCode, readonly SourcingRequestStatusCode[]>>;
export declare const SOURCING_STATUS_LABELS: Record<SourcingRequestStatusCode, string>;
export declare function isAllowedSourcingStatusTransition(from: SourcingRequestStatusCode, to: SourcingRequestStatusCode): boolean;
export declare class SourcingStatusTransitionError extends Error {
    readonly from: SourcingRequestStatusCode;
    readonly to: SourcingRequestStatusCode;
    constructor(from: SourcingRequestStatusCode, to: SourcingRequestStatusCode);
}
export declare function assertSourcingStatusTransition(from: SourcingRequestStatusCode, to: SourcingRequestStatusCode): void;
