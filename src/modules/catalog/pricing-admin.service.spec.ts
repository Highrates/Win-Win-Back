import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { PricingAdminService } from './pricing-admin.service';

const profileEntity = {
  id: 'pp-1',
  name: 'Розница',
  sortOrder: 0,
  isDefault: true,
  containerType: '40',
  containerMaxWeightKg: null,
  containerMaxVolumeM3: null,
  cnyRate: new Prisma.Decimal(11.5),
  usdRate: new Prisma.Decimal(79),
  eurRate: new Prisma.Decimal(91),
  transferCommissionPct: new Prisma.Decimal(4),
  customsAdValoremPct: new Prisma.Decimal(10),
  customsWeightPct: new Prisma.Decimal(8),
  vatPct: new Prisma.Decimal(22),
  markupPct: new Prisma.Decimal(0),
  agentRub: new Prisma.Decimal(50000),
  warehousePortUsd: new Prisma.Decimal(950),
  fobUsd: new Prisma.Decimal(4000),
  portMskRub: new Prisma.Decimal(280000),
  extraLogisticsRub: new Prisma.Decimal(141000),
  createdAt: new Date(),
  updatedAt: new Date(),
  categories: [{ categoryId: 'cat-a' }],
};

describe('PricingAdminService', () => {
  let prisma: {
    pricingProfile: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    pricingProfileCategory: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
    category: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let svc: PricingAdminService;

  beforeEach(() => {
    prisma = {
      pricingProfile: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      pricingProfileCategory: { deleteMany: vi.fn() },
      category: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cat-a' }, { id: 'cat-b' }]),
      },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    svc = new PricingAdminService(prisma as never);
  });

  it('createProfile: не проверяет конфликт категорий', async () => {
    prisma.pricingProfile.create.mockResolvedValue({
      ...profileEntity,
      isDefault: false,
      categories: [{ categoryId: 'cat-a' }, { categoryId: 'cat-b' }],
    });

    await svc.createProfile({
      name: 'Партнёры',
      containerType: '40',
      cnyRate: 11.5,
      usdRate: 79,
      eurRate: 91,
      transferCommissionPct: 4,
      customsAdValoremPct: 10,
      customsWeightPct: 8,
      vatPct: 22,
      markupPct: -5,
      agentRub: 50000,
      warehousePortUsd: 950,
      fobUsd: 4000,
      portMskRub: 280000,
      extraLogisticsRub: 141000,
      categoryIds: ['cat-a', 'cat-b'],
    });

    expect(prisma.pricingProfile.create).toHaveBeenCalledOnce();
  });

  it('findProfileForCategoryIds: только isDefault=true', async () => {
    prisma.pricingProfile.findFirst.mockResolvedValue(profileEntity);
    await svc.findProfileForCategoryIds(['cat-a']);
    expect(prisma.pricingProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('updateProfile setAsPrimary: без полей формы', async () => {
    const nonDefault = { ...profileEntity, id: 'pp-2', isDefault: false };
    const asDefault = { ...profileEntity, id: 'pp-2', isDefault: true };
    prisma.pricingProfile.findUnique
      .mockResolvedValueOnce(nonDefault)
      .mockResolvedValueOnce(nonDefault)
      .mockResolvedValueOnce(asDefault);
    const row = await svc.updateProfile('pp-2', { setAsPrimary: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(row.isDefault).toBe(true);
  });

  it('deleteProfile: нельзя удалить основной', async () => {
    prisma.pricingProfile.findUnique.mockResolvedValue(profileEntity);
    await expect(svc.deleteProfile('pp-1')).rejects.toThrow('Нельзя удалить основной профиль');
    expect(prisma.pricingProfile.delete).not.toHaveBeenCalled();
  });
});
