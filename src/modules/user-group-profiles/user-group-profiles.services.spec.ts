import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReferralProgramProfilesService } from './referral-program-profiles.service';
import { DesignerBonusProfilesService } from './designer-bonus-profiles.service';
import { ProgramConfigSyncService } from './program-config-sync.service';
import { ReferralsService } from '../referrals/referrals.service';
function referralRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref-a',
    name: 'Основной',
    sortOrder: 0,
    isDefault: true,
    enabled: true,
    level1Percent: new Prisma.Decimal(5),
    level2Percent: new Prisma.Decimal(3),
    minimumOrderSiteTotalRub: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function designerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'des-a',
    name: 'Основной',
    sortOrder: 0,
    isDefault: true,
    designerOwnCatalogBonusPercent: new Prisma.Decimal(10),
    designerOwnMinimumCatalogSiteTotalRub: 100_000,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ReferralProgramProfilesService', () => {
  let prisma: {
    referralProgramProfile: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let configSync: { mirrorReferralProgram: ReturnType<typeof vi.fn> };
  let referralsService: { recalculateRewardsIfProgramChanged: ReturnType<typeof vi.fn> };
  let svc: ReferralProgramProfilesService;

  beforeEach(() => {
    prisma = {
      referralProgramProfile: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        aggregate: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    configSync = { mirrorReferralProgram: vi.fn().mockResolvedValue(undefined) };
    referralsService = { recalculateRewardsIfProgramChanged: vi.fn().mockResolvedValue(undefined) };
    svc = new ReferralProgramProfilesService(
      prisma as never,
      referralsService as never,
      configSync as never,
    );
  });

  it('remove: запрещает удаление основного профиля', async () => {
    prisma.referralProgramProfile.findUnique.mockResolvedValue(referralRow({ isDefault: true }));
    await expect(svc.remove('ref-a')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.referralProgramProfile.delete).not.toHaveBeenCalled();
  });

  it('update основного: только name — без mirrorReferralProgram', async () => {
    const existing = referralRow();
    const updated = referralRow({ name: 'Партнёры' });
    prisma.referralProgramProfile.findUnique.mockResolvedValue(existing);
    prisma.referralProgramProfile.findFirst.mockResolvedValue(existing);
    prisma.referralProgramProfile.update.mockResolvedValue(updated);

    await svc.update('ref-a', { name: 'Партнёры' });

    expect(configSync.mirrorReferralProgram).not.toHaveBeenCalled();
    expect(referralsService.recalculateRewardsIfProgramChanged).toHaveBeenCalledOnce();
  });

  it('update основного: смена L1 — mirror + recalculate', async () => {
    const existing = referralRow();
    const updated = referralRow({ level1Percent: new Prisma.Decimal(7) });
    prisma.referralProgramProfile.findUnique.mockResolvedValue(existing);
    prisma.referralProgramProfile.findFirst.mockResolvedValue(existing);
    prisma.referralProgramProfile.update.mockResolvedValue(updated);

    await svc.update('ref-a', { level1Percent: 7 });

    expect(configSync.mirrorReferralProgram).toHaveBeenCalledWith({
      level1Percent: 7,
      level2Percent: 3,
      minimumOrderSiteTotalRub: 0,
    });
    expect(referralsService.recalculateRewardsIfProgramChanged).toHaveBeenCalledOnce();
  });

  it('setAsPrimary: mirror только если ставки нового профиля отличаются', async () => {
    const previousPrimary = referralRow({ id: 'ref-a', isDefault: true });
    const existing = referralRow({
      id: 'ref-b',
      isDefault: false,
      level1Percent: new Prisma.Decimal(5),
    });
    const updated = referralRow({ id: 'ref-b', isDefault: true });
    prisma.referralProgramProfile.findUnique.mockResolvedValue(existing);
    prisma.referralProgramProfile.findFirst.mockResolvedValue(previousPrimary);
    prisma.referralProgramProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralProgramProfile.update.mockResolvedValue(updated);

    await svc.update('ref-b', { setAsPrimary: true });

    expect(configSync.mirrorReferralProgram).not.toHaveBeenCalled();
    expect(referralsService.recalculateRewardsIfProgramChanged).toHaveBeenCalledOnce();
  });

  it('create: копирует ставки с основного профиля', async () => {
    prisma.referralProgramProfile.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
    prisma.referralProgramProfile.findFirst.mockResolvedValue(
      referralRow({ level1Percent: new Prisma.Decimal(8), level2Percent: new Prisma.Decimal(2) }),
    );
    prisma.referralProgramProfile.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...referralRow({ isDefault: false }),
        ...data,
        id: 'ref-new',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await svc.create({ name: 'Новый' });

    expect(prisma.referralProgramProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level1Percent: expect.any(Prisma.Decimal),
          level2Percent: expect.any(Prisma.Decimal),
        }),
      }),
    );
    const createArg = prisma.referralProgramProfile.create.mock.calls[0][0];
    expect(createArg.data.level1Percent.toNumber()).toBe(8);
    expect(createArg.data.level2Percent.toNumber()).toBe(2);
  });
});

describe('DesignerBonusProfilesService', () => {
  let prisma: {
    designerBonusProfile: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let configSync: { mirrorDesignerBonus: ReturnType<typeof vi.fn> };
  let svc: DesignerBonusProfilesService;

  beforeEach(() => {
    prisma = {
      designerBonusProfile: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        aggregate: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    configSync = { mirrorDesignerBonus: vi.fn().mockResolvedValue(undefined) };
    svc = new DesignerBonusProfilesService(prisma as never, configSync as never);
  });

  it('remove: запрещает удаление основного профиля', async () => {
    prisma.designerBonusProfile.findUnique.mockResolvedValue(designerRow({ isDefault: true }));
    await expect(svc.remove('des-a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create: копирует % и порог с основного профиля', async () => {
    prisma.designerBonusProfile.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
    prisma.designerBonusProfile.findFirst.mockResolvedValue(
      designerRow({
        designerOwnCatalogBonusPercent: new Prisma.Decimal(15),
        designerOwnMinimumCatalogSiteTotalRub: 200_000,
      }),
    );
    prisma.designerBonusProfile.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...designerRow({ isDefault: false }),
        ...data,
        id: 'des-new',
      }),
    );

    await svc.create({ name: 'Новый' });

    const createArg = prisma.designerBonusProfile.create.mock.calls[0][0];
    expect(createArg.data.designerOwnCatalogBonusPercent.toNumber()).toBe(15);
    expect(createArg.data.designerOwnMinimumCatalogSiteTotalRub).toBe(200_000);
  });

  it('update основного: только name — без mirrorDesignerBonus', async () => {
    const existing = designerRow();
    const updated = designerRow({ name: 'VIP' });
    prisma.designerBonusProfile.findUnique.mockResolvedValue(existing);
    prisma.designerBonusProfile.findFirst.mockResolvedValue(existing);
    prisma.designerBonusProfile.update.mockResolvedValue(updated);

    await svc.update('des-a', { name: 'VIP' });

    expect(configSync.mirrorDesignerBonus).not.toHaveBeenCalled();
  });
});

describe('ReferralsService legacy ↔ profiles API', () => {
  it('getAdminProgramConfig отдаёт enabled из resolver', async () => {
    const profileResolver = {
      resolveReferralProgramForUser: vi.fn().mockResolvedValue({
        profileId: 'ref-a',
        enabled: false,
        level1Percent: 5,
        level2Percent: 3,
        minimumOrderSiteTotalRub: 1000,
      }),
    };
    const svc = new ReferralsService(
      {} as never,
      {} as never,
      profileResolver as never,
      {} as never,
    );

    await expect(svc.getAdminProgramConfig()).resolves.toEqual({
      enabled: false,
      level1Percent: 5,
      level2Percent: 3,
      minimumOrderSiteTotalRub: 1000,
    });
  });

  it('recalculateRewardsIfProgramChanged: не вызывает полный пересчёт без изменений', async () => {
    const svc = new ReferralsService({} as never, {} as never, {} as never, {} as never);
    const recalc = vi.spyOn(svc, 'recalculateRewardsForAllCompletedOrders').mockResolvedValue();

    await svc.recalculateRewardsIfProgramChanged(
      { enabled: true, level1Percent: 5, level2Percent: 3, minimumOrderSiteTotalRub: 0 },
      { enabled: true, level1Percent: 5, level2Percent: 3, minimumOrderSiteTotalRub: 0 },
    );

    expect(recalc).not.toHaveBeenCalled();
  });

  it('recalculateRewardsIfProgramChanged: пересчёт при смене enabled', async () => {
    const svc = new ReferralsService({} as never, {} as never, {} as never, {} as never);
    const recalc = vi.spyOn(svc, 'recalculateRewardsForAllCompletedOrders').mockResolvedValue();

    await svc.recalculateRewardsIfProgramChanged(
      { enabled: true, level1Percent: 5, level2Percent: 3, minimumOrderSiteTotalRub: 0 },
      { enabled: false, level1Percent: 5, level2Percent: 3, minimumOrderSiteTotalRub: 0 },
    );

    expect(recalc).toHaveBeenCalledOnce();
  });
});

describe('ReferralsService.getPartnerProgramSummary', () => {
  it('не строит реферальные строки и pipeline при enabled=false у покупателя', async () => {
    const profileResolver = {
      resolveReferralProgramForUser: vi.fn().mockResolvedValue({
        profileId: 'ref-a',
        enabled: false,
        level1Percent: 5,
        level2Percent: 3,
        minimumOrderSiteTotalRub: 0,
      }),
      resolveDesignerBonusForUser: vi.fn().mockResolvedValue({
        profileId: 'bonus-a',
        designerOwnCatalogBonusPercent: 0,
        designerOwnMinimumCatalogSiteTotalRub: 0,
      }),
      resolveDesignerBonusForOrder: vi.fn().mockResolvedValue({
        profileId: 'bonus-a',
        designerOwnCatalogBonusPercent: 0,
        designerOwnMinimumCatalogSiteTotalRub: 0,
      }),
    };
    const orderSettings = {
      getResolved: vi.fn().mockResolvedValue({
        designerOwnCatalogBonusPercent: 0,
        designerOwnMinimumCatalogSiteTotalRub: 0,
        kpMaxLineDiscountPercent: 100,
      }),
      computeDesignerOwnCatalogBonusRub: vi.fn().mockReturnValue(new Prisma.Decimal(0)),
    };
    const prisma = {
      userProfile: {
        findUnique: vi.fn().mockResolvedValue({ winWinPartnerApproved: true }),
      },
      referral: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ referredId: 'buyer-1' }])
          .mockResolvedValueOnce([]),
      },
      order: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'order-1',
              userId: 'buyer-1',
              status: 'PAID',
              updatedAt: new Date('2026-06-01'),
              items: [{ price: new Prisma.Decimal(10_000), quantity: 1 }],
            },
          ])
          .mockResolvedValueOnce([]),
      },
    };
    const svc = new ReferralsService(
      prisma as never,
      orderSettings as never,
      profileResolver as never,
      {} as never,
    );

    const summary = await svc.getPartnerProgramSummary('partner-1');

    expect(summary.isWinWinPartner).toBe(true);
    expect(summary.program.enabled).toBe(false);
    expect(summary.personalLines.filter((l) => l.source === 'REFERRAL')).toHaveLength(0);
    expect(summary.teamLines).toHaveLength(0);
    expect(summary.designerBonus.bonusPercent).toBe(0);
    expect(summary.totals.pipelineOutlookRub).toBe('0.00');
    expect(summary.totals.teamCompletedRub).toBe('0.00');
  });
});

describe('ProgramConfigSyncService', () => {
  it('mirrorReferralProgram: upsert трёх ключей ReferralConfig', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      referralConfig: { upsert },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    const sync = new ProgramConfigSyncService(prisma as never);

    await sync.mirrorReferralProgram({
      level1Percent: 5,
      level2Percent: 3,
      minimumOrderSiteTotalRub: 1000,
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls.map((c) => c[0].where.key)).toEqual([
      'referral_level1_percent',
      'referral_level2_percent',
      'referral_minimum_order_site_total_rub',
    ]);
  });
});
