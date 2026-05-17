import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COMPLETED_STATUSES,
  CUSTOMER_IN_WORK_STATUSES_LIST,
  KP_PUBLISH_NEXT_STATUSES,
  ORDER_STATUS_FLOW,
} from './constants';

describe('ORDER_STATUS_FLOW', () => {
  it('matches expected lifecycle length', () => {
    expect(ORDER_STATUS_FLOW).toHaveLength(11);
  });

  it('KP publish options exclude PENDING_APPROVAL only', () => {
    expect(KP_PUBLISH_NEXT_STATUSES).toHaveLength(ORDER_STATUS_FLOW.length - 1);
    expect(KP_PUBLISH_NEXT_STATUSES).not.toContain('PENDING_APPROVAL');
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
