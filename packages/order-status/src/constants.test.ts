import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COMPLETED_STATUSES,
  CUSTOMER_IN_WORK_STATUSES_LIST,
  KP_PUBLISH_ALLOWED_ORDER_STATUSES,
  KP_PUBLISH_NEXT_STATUSES,
  ORDER_STATUS_FLOW,
} from './constants';

describe('ORDER_STATUS_FLOW', () => {
  it('matches expected lifecycle length', () => {
    expect(ORDER_STATUS_FLOW).toHaveLength(11);
  });

  it('KP publish next status — только PROPOSAL_FORMED / APPROVED', () => {
    expect([...KP_PUBLISH_NEXT_STATUSES]).toEqual(['PROPOSAL_FORMED', 'APPROVED']);
    expect(KP_PUBLISH_NEXT_STATUSES).not.toContain('COMPLETED');
    expect(KP_PUBLISH_NEXT_STATUSES).not.toContain('PENDING_PAYMENT');
  });

  it('KP publish allowed order statuses — до оплаты', () => {
    expect([...KP_PUBLISH_ALLOWED_ORDER_STATUSES]).toEqual([
      'PENDING_APPROVAL',
      'PROPOSAL_FORMED',
      'APPROVED',
    ]);
    expect(KP_PUBLISH_ALLOWED_ORDER_STATUSES).not.toContain('PENDING_PAYMENT');
    expect(KP_PUBLISH_ALLOWED_ORDER_STATUSES).not.toContain('PAID');
  });

  it('admin buckets are disjoint subsets of flow', () => {
    for (const s of ADMIN_ACTIVE_STATUSES) {
      expect(ORDER_STATUS_FLOW).toContain(s);
    }
    for (const s of ADMIN_COMPLETED_STATUSES) {
      expect(ORDER_STATUS_FLOW).toContain(s);
    }
    expect(CUSTOMER_IN_WORK_STATUSES_LIST).not.toContain('COMPLETED');
  });
});
