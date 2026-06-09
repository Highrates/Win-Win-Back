import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderSettingsService } from './order-settings.service';

describe('OrderSettingsService.patchAdmin', () => {
  let configSync: { mirrorKpMaxLineDiscountPercent: ReturnType<typeof vi.fn> };
  let profileResolver: {
    resolveDesignerBonusForUser: ReturnType<typeof vi.fn>;
  };
  let prisma: { referralConfig: { findUnique: ReturnType<typeof vi.fn> } };
  let svc: OrderSettingsService;

  beforeEach(() => {
    configSync = { mirrorKpMaxLineDiscountPercent: vi.fn().mockResolvedValue(undefined) };
    profileResolver = {
      resolveDesignerBonusForUser: vi.fn().mockResolvedValue({
        profileId: 'des-a',
        designerOwnCatalogBonusPercent: 10,
        designerOwnMinimumCatalogSiteTotalRub: 50_000,
      }),
    };
    prisma = {
      referralConfig: {
        findUnique: vi.fn().mockResolvedValue({ value: '80' }),
      },
    };
    svc = new OrderSettingsService(prisma as never, profileResolver as never, configSync as never);
  });

  it('сохраняет только kpMaxLineDiscountPercent', async () => {
    const result = await svc.patchAdmin({ kpMaxLineDiscountPercent: 75 });

    expect(configSync.mirrorKpMaxLineDiscountPercent).toHaveBeenCalledWith(75);
    expect(result.kpMaxLineDiscountPercent).toBe(80);
    expect(result.designerOwnCatalogBonusPercent).toBe(10);
  });

  it('без kpMaxLineDiscountPercent — 400, не молчаливый no-op', async () => {
    await expect(svc.patchAdmin({} as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(configSync.mirrorKpMaxLineDiscountPercent).not.toHaveBeenCalled();
  });
});

describe('OrderSettingsService.getResolved', () => {
  it('передаёт userId в resolveDesignerBonusForUser', async () => {
    const profileResolver = {
      resolveDesignerBonusForUser: vi.fn().mockResolvedValue({
        profileId: 'des-vip',
        designerOwnCatalogBonusPercent: 12,
        designerOwnMinimumCatalogSiteTotalRub: 100_000,
      }),
    };
    const prisma = {
      referralConfig: { findUnique: vi.fn().mockResolvedValue({ value: '100' }) },
    };
    const svc = new OrderSettingsService(prisma as never, profileResolver as never, {
      mirrorKpMaxLineDiscountPercent: vi.fn(),
    } as never);

    const r = await svc.getResolved('user-vip');
    expect(profileResolver.resolveDesignerBonusForUser).toHaveBeenCalledWith('user-vip');
    expect(r.designerOwnCatalogBonusPercent).toBe(12);
    expect(r.designerOwnMinimumCatalogSiteTotalRub).toBe(100_000);
  });
});
