import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductPriceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { PricingAdminService } from './pricing-admin.service';
import { calcMskAndRetailRub, type PricingProfileCalcInput } from './pricing-calculation';

export type VariantPricingInput = {
  price?: number | null;
  priceMode?: 'manual' | 'formula';
  costPriceCny?: number | null;
  weightKg?: number | null;
  volumeLiters?: number | null;
};

@Injectable()
export class CatalogVariantPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingAdmin: PricingAdminService,
    private readonly productSearchIndex: ProductSearchIndexService,
  ) {}

  /** Объём в м³ из поля формы (вручную). */
  normalizeOptionalVolumeM3(raw: number | null | undefined): Prisma.Decimal | null {
    if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
    return new Prisma.Decimal(raw);
  }

  private prismaPricingProfileToCalc(p: {
    containerType: string;
    containerMaxWeightKg: Prisma.Decimal | null;
    containerMaxVolumeM3: Prisma.Decimal | null;
    cnyRate: Prisma.Decimal;
    usdRate: Prisma.Decimal;
    eurRate: Prisma.Decimal;
    transferCommissionPct: Prisma.Decimal;
    customsAdValoremPct: Prisma.Decimal;
    customsWeightPct: Prisma.Decimal;
    vatPct: Prisma.Decimal;
    markupPct: Prisma.Decimal;
    agentRub: Prisma.Decimal;
    warehousePortUsd: Prisma.Decimal;
    fobUsd: Prisma.Decimal;
    portMskRub: Prisma.Decimal;
    extraLogisticsRub: Prisma.Decimal;
  }): PricingProfileCalcInput {
    return {
      containerType: p.containerType,
      containerMaxWeightKg: p.containerMaxWeightKg?.toNumber() ?? null,
      containerMaxVolumeM3: p.containerMaxVolumeM3?.toNumber() ?? null,
      cnyRate: p.cnyRate.toNumber(),
      usdRate: p.usdRate.toNumber(),
      eurRate: p.eurRate.toNumber(),
      transferCommissionPct: p.transferCommissionPct.toNumber(),
      customsAdValoremPct: p.customsAdValoremPct.toNumber(),
      customsWeightPct: p.customsWeightPct.toNumber(),
      vatPct: p.vatPct.toNumber(),
      markupPct: p.markupPct.toNumber(),
      agentRub: p.agentRub.toNumber(),
      warehousePortUsd: p.warehousePortUsd.toNumber(),
      fobUsd: p.fobUsd.toNumber(),
      portMskRub: p.portMskRub.toNumber(),
      extraLogisticsRub: p.extraLogisticsRub.toNumber(),
    };
  }

  async resolveVariantPriceForWrite(
    dto: VariantPricingInput,
    categoryIdsForMatch: string[],
  ): Promise<{
    price: Prisma.Decimal;
    priceMode: ProductPriceMode;
    costPriceCny: Prisma.Decimal | null;
  }> {
    const mode =
      dto.priceMode === 'formula' ? ProductPriceMode.FORMULA : ProductPriceMode.MANUAL;

    const costRaw = dto.costPriceCny;
    const costDec =
      costRaw != null && Number.isFinite(costRaw) && costRaw > 0
        ? new Prisma.Decimal(costRaw)
        : null;

    if (mode === ProductPriceMode.MANUAL) {
      const p = dto.price ?? 0;
      return {
        price: new Prisma.Decimal(p),
        priceMode: mode,
        costPriceCny: costDec,
      };
    }

    const cny = costRaw;
    const wkg = dto.weightKg;
    const vm3 = dto.volumeLiters;
    if (cny == null || !Number.isFinite(cny) || cny <= 0) {
      throw new BadRequestException('Укажите закупочную цену в юанях (CNY) для расчёта по формуле');
    }
    if (wkg == null || !Number.isFinite(wkg) || wkg <= 0) {
      throw new BadRequestException('Укажите вес брутто (кг) для расчёта по формуле');
    }
    if (vm3 == null || !Number.isFinite(vm3) || vm3 <= 0) {
      throw new BadRequestException('Укажите объём брутто (м³) для расчёта по формуле');
    }

    const profile = await this.pricingAdmin.findProfileForCategoryIds(categoryIdsForMatch);
    if (!profile) {
      throw new BadRequestException(
        'Нет профиля ценообразования для категорий этого товара. Создайте профиль в Настройки → Ценообразование.',
      );
    }

    const { retailRub } = calcMskAndRetailRub(this.prismaPricingProfileToCalc(profile), {
      costPriceCny: cny,
      grossWeightKg: wkg,
      volumeM3: vm3,
    });

    return {
      price: new Prisma.Decimal(retailRub),
      priceMode: ProductPriceMode.FORMULA,
      costPriceCny: new Prisma.Decimal(cny),
    };
  }

  async recalculateAllFormulaProductPrices(): Promise<void> {
    const variants = await this.prisma.productVariant.findMany({
      where: { priceMode: ProductPriceMode.FORMULA },
      select: {
        id: true,
        productId: true,
        costPriceCny: true,
        weightKg: true,
        volumeLiters: true,
        product: {
          select: {
            categoryId: true,
            productCategories: { select: { categoryId: true } },
          },
        },
      },
    });
    const touchedProducts = new Set<string>();
    for (const v of variants) {
      const cny = v.costPriceCny?.toNumber();
      const wkg = v.weightKg?.toNumber();
      const vm3 = v.volumeLiters?.toNumber();
      if (
        cny == null ||
        !Number.isFinite(cny) ||
        cny <= 0 ||
        wkg == null ||
        !Number.isFinite(wkg) ||
        wkg <= 0 ||
        vm3 == null ||
        !Number.isFinite(vm3) ||
        vm3 <= 0
      ) {
        continue;
      }
      const categoryIds = [
        v.product.categoryId,
        ...v.product.productCategories.map((c) => c.categoryId),
      ];
      const profile = await this.pricingAdmin.findProfileForCategoryIds(categoryIds);
      if (!profile) continue;
      const { retailRub } = calcMskAndRetailRub(this.prismaPricingProfileToCalc(profile), {
        costPriceCny: cny,
        grossWeightKg: wkg,
        volumeM3: vm3,
      });
      await this.prisma.productVariant.update({
        where: { id: v.id },
        data: { price: new Prisma.Decimal(retailRub) },
      });
      touchedProducts.add(v.productId);
    }
    for (const pid of touchedProducts) {
      void this.productSearchIndex.syncProduct(pid);
    }
  }
}
