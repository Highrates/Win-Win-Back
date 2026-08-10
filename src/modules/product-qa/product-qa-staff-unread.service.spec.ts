import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaMessageStatus, UserRole } from '@prisma/client';
import { ProductQaStaffUnreadService } from './product-qa-staff-unread.service';

function buildStaffUnreadService(premod = false) {
  const prisma = {
    user: { findUnique: vi.fn() },
    productQaStaffReadState: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) =>
      key === 'PRODUCT_QA_PREMODERATION' ? (premod ? '1' : '0') : undefined,
    ),
  };
  const core = {
    assertStaffCatalogAccess: vi.fn(async () => undefined),
    resolveProductById: vi.fn(async () => ({ id: 'p1', slug: 'chair' })),
  };
  const service = new ProductQaStaffUnreadService(
    prisma as never,
    config as never,
    core as never,
  );
  return { service, prisma, core };
}

describe('ProductQaStaffUnreadService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts unread via SQL with staff login baseline (no pre-mod)', async () => {
    const { service, prisma } = buildStaffUnreadService(false);
    const baseline = new Date('2026-08-01T00:00:00.000Z');
    prisma.user.findUnique.mockResolvedValue({ lastAdminLoginAt: baseline, createdAt: baseline });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 2n }])
      .mockResolvedValueOnce([{ count: 0n }]);

    const total = await service.countUnreadForStaff('staff1');

    expect(total).toBe(2);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'staff1' },
      select: { lastAdminLoginAt: true, createdAt: true },
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('uses PENDING statuses when pre-moderation enabled', async () => {
    const { service, prisma } = buildStaffUnreadService(true);
    prisma.user.findUnique.mockResolvedValue({
      lastAdminLoginAt: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([{ count: 0n }]);

    await service.countUnreadForStaff('staff1');

    expect(service.staffUnreadMessageStatuses()).toEqual([ProductQaMessageStatus.PENDING]);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('markProductSeen upserts read state', async () => {
    const { service, prisma, core } = buildStaffUnreadService();
    prisma.productQaStaffReadState.upsert.mockResolvedValue({});

    const res = await service.markProductSeen('staff1', UserRole.ADMIN, 'p1');

    expect(res).toEqual({ ok: true });
    expect(core.assertStaffCatalogAccess).toHaveBeenCalled();
    expect(prisma.productQaStaffReadState.upsert).toHaveBeenCalled();
  });
});
