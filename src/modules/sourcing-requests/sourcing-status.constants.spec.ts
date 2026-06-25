import { BadRequestException } from '@nestjs/common';
import { SourcingRequestStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  SOURCING_STATUS_TRANSITIONS,
  assertSourcingStatusTransition,
} from './sourcing-status.constants';

describe('assertSourcingStatusTransition', () => {
  it('разрешает допустимые переходы', () => {
    for (const [from, targets] of Object.entries(SOURCING_STATUS_TRANSITIONS) as [
      SourcingRequestStatus,
      readonly SourcingRequestStatus[],
    ][]) {
      for (const to of targets) {
        expect(() => assertSourcingStatusTransition(from, to)).not.toThrow();
      }
    }
  });

  it('разрешает переход в тот же статус', () => {
    for (const status of Object.values(SourcingRequestStatus)) {
      expect(() => assertSourcingStatusTransition(status, status)).not.toThrow();
    }
  });

  it('запрещает COMPLETED → IN_PROGRESS', () => {
    expect(() =>
      assertSourcingStatusTransition(
        SourcingRequestStatus.COMPLETED,
        SourcingRequestStatus.IN_PROGRESS,
      ),
    ).toThrow(BadRequestException);
  });

  it('запрещает PENDING_REVIEW → COMPLETED', () => {
    expect(() =>
      assertSourcingStatusTransition(
        SourcingRequestStatus.PENDING_REVIEW,
        SourcingRequestStatus.COMPLETED,
      ),
    ).toThrow(BadRequestException);
  });
});
