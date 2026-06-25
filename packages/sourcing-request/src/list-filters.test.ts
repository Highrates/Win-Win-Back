import { describe, expect, it } from 'vitest';
import { adminBucketStatuses, userScopeStatuses } from './list-filters';
import { SOURCING_STATUS } from './status';

describe('adminBucketStatuses', () => {
  it('maps admin buckets', () => {
    expect(adminBucketStatuses('new')).toEqual([SOURCING_STATUS.PENDING_REVIEW]);
    expect(adminBucketStatuses('active')).toEqual([SOURCING_STATUS.IN_PROGRESS]);
    expect(adminBucketStatuses('completed')).toEqual([
      SOURCING_STATUS.COMPLETED,
      SOURCING_STATUS.CANCELLED,
    ]);
  });

  it('returns undefined for unknown bucket', () => {
    expect(adminBucketStatuses(undefined)).toBeUndefined();
    expect(adminBucketStatuses('')).toBeUndefined();
    expect(adminBucketStatuses('archive')).toBeUndefined();
  });
});

describe('userScopeStatuses', () => {
  it('maps LK scopes', () => {
    expect(userScopeStatuses('work')).toEqual([
      SOURCING_STATUS.PENDING_REVIEW,
      SOURCING_STATUS.IN_PROGRESS,
    ]);
    expect(userScopeStatuses('completed')).toEqual([
      SOURCING_STATUS.COMPLETED,
      SOURCING_STATUS.CANCELLED,
    ]);
  });

  it('returns undefined for unknown scope', () => {
    expect(userScopeStatuses(undefined)).toBeUndefined();
    expect(userScopeStatuses('all')).toBeUndefined();
  });
});
