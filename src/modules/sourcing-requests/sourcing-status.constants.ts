import { BadRequestException } from '@nestjs/common';
import { SourcingRequestStatus } from '@prisma/client';
import {
  SOURCING_STATUS_TRANSITIONS as SHARED_SOURCING_STATUS_TRANSITIONS,
  SourcingStatusTransitionError,
  assertSourcingStatusTransition as assertSharedSourcingStatusTransition,
} from '@win-win/sourcing-request';

/** Допустимые переходы статуса заявки на подбор (FSM). */
export const SOURCING_STATUS_TRANSITIONS: Readonly<
  Record<SourcingRequestStatus, readonly SourcingRequestStatus[]>
> = SHARED_SOURCING_STATUS_TRANSITIONS as Readonly<
  Record<SourcingRequestStatus, readonly SourcingRequestStatus[]>
>;

export function assertSourcingStatusTransition(
  from: SourcingRequestStatus,
  to: SourcingRequestStatus,
): void {
  try {
    assertSharedSourcingStatusTransition(from, to);
  } catch (e) {
    if (e instanceof SourcingStatusTransitionError) {
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}
