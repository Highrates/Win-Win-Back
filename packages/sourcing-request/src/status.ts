export const SOURCING_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type SourcingRequestStatusCode = (typeof SOURCING_STATUS)[keyof typeof SOURCING_STATUS];

/** Допустимые переходы статуса заявки на подбор (FSM). */
export const SOURCING_STATUS_TRANSITIONS: Readonly<
  Record<SourcingRequestStatusCode, readonly SourcingRequestStatusCode[]>
> = {
  PENDING_REVIEW: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const SOURCING_STATUS_LABELS: Record<SourcingRequestStatusCode, string> = {
  PENDING_REVIEW: 'На рассмотрении',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
};

export function isAllowedSourcingStatusTransition(
  from: SourcingRequestStatusCode,
  to: SourcingRequestStatusCode,
): boolean {
  if (from === to) return true;
  return SOURCING_STATUS_TRANSITIONS[from].includes(to);
}

export class SourcingStatusTransitionError extends Error {
  readonly from: SourcingRequestStatusCode;
  readonly to: SourcingRequestStatusCode;

  constructor(from: SourcingRequestStatusCode, to: SourcingRequestStatusCode) {
    super(`Нельзя перевести заявку из «${SOURCING_STATUS_LABELS[from]}» в «${SOURCING_STATUS_LABELS[to]}»`);
    this.name = 'SourcingStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertSourcingStatusTransition(
  from: SourcingRequestStatusCode,
  to: SourcingRequestStatusCode,
): void {
  if (!isAllowedSourcingStatusTransition(from, to)) {
    throw new SourcingStatusTransitionError(from, to);
  }
}
