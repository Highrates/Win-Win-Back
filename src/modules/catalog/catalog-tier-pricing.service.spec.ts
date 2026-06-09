import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, ProductPriceMode } from '@prisma/client';
import { CatalogTierPricingService } from './catalog-tier-pricing.service';

const tierProfile = {
  id: 'pp-tier',
  name: 'Опт',
  containerType: '40',
  containerMaxWeightKg: null,
  containerMaxVolumeM3: null,
  cnyRate: new Prisma.Decimal(12),
  usdRate: new Prisma.Decimal(90),
  eurRate: new Prisma.Decimal(100),
  transferCommissionPct: new Prisma.Decimal(0),
  customsAdValoremPct: new Prisma.Decimal(0),
  customsWeightPct: new Prisma.Decimal(0),
  vatPct: new Prisma.Decimal(0),
  markupPct: new Prisma.Decimal(10),
  agentRub: new Prisma.Decimal(0),
  warehousePortUsd: new Prisma.Decimal(0),
  fobUsd: new Prisma.Decimal(0),
  portMskRub: new Prisma.Decimal(0),
  extraLogisticsRub: new Prisma.Decimal(0),
  categories: [{ categoryId: 'cat-1' }],
};

describe('CatalogTierPricingService', () => {
  let prisma: { product: { findMany: ReturnType<typeof vi.fn> } };
  let pricingAdmin: {
    findProfileById: ReturnType<typeof vi.fn>;
    profileAppliesToCategoryIds: ReturnType<typeof vi.fn>;
    profileToCalcInput: ReturnType<typeof vi.fn>;
  };
  let profileResolver: { resolveGroupPricingProfileIdForUser: ReturnType<typeof vi.fn> };
  let svc: CatalogTierPricingService;

  beforeEach(() => {
    prisma = { product: { findMany: vi.fn() } };
    pricingAdmin = {
      findProfileById: vi.fn().mockResolvedValue(tierProfile),
      profileAppliesToCategoryIds: vi.fn().mockReturnValue(true),
      profileToCalcInput: vi.fn().mockReturnValue({
        containerType: '40',
        cnyRate: 12,
        usdRate: 90,
        eurRate: 100,
        transferCommissionPct: 0,
        customsAdValoremPct: 0,
        customsWeightPct: 0,
        vatPct: 0,
        markupPct: 10,
        agentRub: 0,
        warehousePortUsd: 0,
        fobUsd: 0,
        portMskRub: 0,
        extraLogisticsRub: 0,
      }),
    };
    profileResolver = {
      resolveGroupPricingProfileIdForUser: vi.fn().mockResolvedValue('pp-tier'),
    };
    svc = new CatalogTierPricingService(
      prisma as never,
      pricingAdmin as never,
      profileResolver as never,
    );
  });

  it('без userId — hits без изменений', async () => {
    const hits = [{ id: 'p1', priceMin: 100_000, priceMax: 100_000 }];
    await expect(svc.enrichSearchHits(hits)).resolves.toEqual(hits);
    expect(profileResolver.resolveGroupPricingProfileIdForUser).not.toHaveBeenCalled();
  });

  it('без pricingProfileId у группы — hits без изменений', async () => {
    profileResolver.resolveGroupPricingProfileIdForUser.mockResolvedValue(null);
    const hits = [{ id: 'p1', priceMin: 100_000 }];
    await expect(svc.enrichSearchHits(hits, 'user-1')).resolves.toEqual(hits);
  });

  it('FORMULA: пересчитывает priceMin/priceMax для tier-профиля группы', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        categoryId: 'cat-1',
        productCategories: [],
        variants: [
          {
            price: new Prisma.Decimal(200_000),
            priceMode: ProductPriceMode.FORMULA,
            costPriceCny: new Prisma.Decimal(1000),
            weightKg: new Prisma.Decimal(10),
            volumeLiters: new Prisma.Decimal(1),
          },
        ],
      },
    ]);

    const hits = [{ id: 'p1', priceMin: 200_000, priceMax: 200_000, price: 200_000 }];
    const out = await svc.enrichSearchHits(hits, 'user-vip');
    expect(out[0].priceMin).toBe(13_200);
    expect(out[0].priceMax).toBe(13_200);
    expect(out[0].price).toBe(13_200);
  });

  it('resolveVariantDisplayPricesForUser: PDP-варианты', async () => {
    const prices = await svc.resolveVariantDisplayPricesForUser(
      'user-vip',
      'cat-1',
      [],
      [
        {
          price: new Prisma.Decimal(200_000),
          priceMode: ProductPriceMode.FORMULA,
          costPriceCny: new Prisma.Decimal(1000),
          weightKg: new Prisma.Decimal(10),
          volumeLiters: new Prisma.Decimal(1),
        },
      ],
    );
    expect(prices[0]).toBe(13_200);
  });

  it('resolveOrderLineUnitPriceRub: tier для SKU в черновике заказа', async () => {
    prisma.product.findMany = vi.fn();
    prisma.productVariant = {
      findFirst: vi.fn().mockResolvedValue({
        price: new Prisma.Decimal(200_000),
        priceMode: ProductPriceMode.FORMULA,
        costPriceCny: new Prisma.Decimal(1000),
        weightKg: new Prisma.Decimal(10),
        volumeLiters: new Prisma.Decimal(1),
        product: { categoryId: 'cat-1', productCategories: [] },
      }),
    } as never;

    const unit = await svc.resolveOrderLineUnitPriceRub('user-vip', 'p1', 'var-1', null);
    expect(unit).toBe(13_200);
  });

  it('MANUAL: оставляет цену из БД', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        categoryId: 'cat-1',
        productCategories: [],
        variants: [
          {
            price: new Prisma.Decimal(55_000),
            priceMode: ProductPriceMode.MANUAL,
            costPriceCny: null,
            weightKg: null,
            volumeLiters: null,
          },
        ],
      },
    ]);

    const hits = [{ id: 'p1', priceMin: 99_000, priceMax: 99_000 }];
    const out = await svc.enrichSearchHits(hits, 'user-vip');
    expect(out[0].priceMin).toBe(55_000);
    expect(out[0].priceMax).toBe(55_000);
  });
});
