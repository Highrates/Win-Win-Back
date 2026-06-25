import { describe, expect, it } from 'vitest';
import {
  SOURCING_STATUS,
  SOURCING_STATUS_TRANSITIONS,
  assertSourcingStatusTransition,
  isAllowedSourcingStatusTransition,
} from './status';

describe('SOURCING_STATUS_TRANSITIONS FSM', () => {
  it('allows documented transitions', () => {
    for (const [from, targets] of Object.entries(SOURCING_STATUS_TRANSITIONS) as [
      keyof typeof SOURCING_STATUS_TRANSITIONS,
      readonly (keyof typeof SOURCING_STATUS_TRANSITIONS)[],
    ][]) {
      for (const to of targets) {
        expect(isAllowedSourcingStatusTransition(from, to)).toBe(true);
        expect(() => assertSourcingStatusTransition(from, to)).not.toThrow();
      }
    }
  });

  it('allows same status', () => {
    for (const status of Object.values(SOURCING_STATUS)) {
      expect(() => assertSourcingStatusTransition(status, status)).not.toThrow();
    }
  });

  it('blocks illegal jumps', () => {
    expect(() =>
      assertSourcingStatusTransition(SOURCING_STATUS.COMPLETED, SOURCING_STATUS.IN_PROGRESS),
    ).toThrow(/Нельзя перевести заявку/);
    expect(() =>
      assertSourcingStatusTransition(SOURCING_STATUS.PENDING_REVIEW, SOURCING_STATUS.COMPLETED),
    ).toThrow(/Нельзя перевести заявку/);
  });
});
