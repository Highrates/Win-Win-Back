import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { UserGroupProfileResolverService } from './user-group-profile-resolver.service';

const defaultReferral = {
  id: 'ref-default',
  name: 'Основной',
  sortOrder: 0,
  isDefault: true,
  enabled: true,
  level1Percent: new Prisma.Decimal(5),
  level2Percent: new Prisma.Decimal(3),
  minimumOrderSiteTotalRub: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const vipReferral = {
  ...defaultReferral,
  id: 'ref-vip',
  isDefault: false,
  level1Percent: new Prisma.Decimal(8),
  level2Percent: new Prisma.Decimal(4),
};

describe('UserGroupProfileResolverService', () => {
  let prisma: {
    userGroupMember: { findUnique: ReturnType<typeof vi.fn> };
    referralProgramProfile: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    designerBonusProfile: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    referralConfig: { findMany: ReturnType<typeof vi.fn> };
  };
  let svc: UserGroupProfileResolverService;

  beforeEach(() => {
    prisma = {
      userGroupMember: { findUnique: vi.fn().mockResolvedValue(null) },
      referralProgramProfile: {
        findFirst: vi.fn().mockResolvedValue(defaultReferral),
        findUnique: vi.fn(),
      },
      designerBonusProfile: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
      },
      referralConfig: { findMany: vi.fn().mockResolvedValue([]) },
    };
    svc = new UserGroupProfileResolverService(prisma as never);
  });

  it('resolveReferralProgramForUser: без группы — основной профиль', async () => {
    await expect(svc.resolveReferralProgramForUser('user-1')).resolves.toMatchObject({
      profileId: 'ref-default',
      level1Percent: 5,
    });
  });

  it('resolveReferralProgramForUser: с группой — профиль группы', async () => {
    prisma.userGroupMember.findUnique.mockResolvedValue({
      group: { referralProgramProfile: vipReferral },
    });
    await expect(svc.resolveReferralProgramForUser('user-vip')).resolves.toMatchObject({
      profileId: 'ref-vip',
      level1Percent: 8,
      level2Percent: 4,
    });
  });

  it('resolveBuyerReferralOrderContext: снимок на заказе', async () => {
    prisma.referralProgramProfile.findUnique.mockResolvedValue({
      ...defaultReferral,
      id: 'ref-snap',
      enabled: false,
      minimumOrderSiteTotalRub: 50_000,
    });
    await expect(
      svc.resolveBuyerReferralOrderContext({
        userId: 'user-1',
        buyerReferralProgramProfileIdSnapshot: 'ref-snap',
      }),
    ).resolves.toEqual({
      profileId: 'ref-snap',
      enabled: false,
      minimumOrderSiteTotalRub: 50_000,
    });
    expect(prisma.userGroupMember.findUnique).not.toHaveBeenCalled();
  });

  it('getUserGroupLabel: label группы или null', async () => {
    prisma.userGroupMember.findUnique.mockResolvedValue({
      group: { label: '  Pro+  ' },
    });
    await expect(svc.getUserGroupLabel('u1')).resolves.toBe('Pro+');
  });
});
