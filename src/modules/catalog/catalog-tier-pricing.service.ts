import { Injectable } from '@nestjs/common';
import { Prisma, ProductPriceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  collectProductCategoryIds,
  priceToNumber,
} from '../../meilisearch/product-search-doc';
import { UserGroupProfileResolverService } from '../user-group-profiles/user-group-profile-resolver.service';
import { calcMskAndRetailRub, type PricingProfileCalcInput } from './pricing-calculation';
import { PricingAdminService } from './pricing-admin.service';

type VariantForTier = {
  price: Prisma.Decimal;
  priceMode: ProductPriceMode;
  costPriceCny: Prisma.Decimal | null;
  weightKg: Prisma.Decimal | null;
  volumeLiters: Prisma.Decimal | null;
};

function calcFormulaRetailRub(
  variant: VariantForTier,
  calcIn: PricingProfileCalcInput,
): number | null {
  if (variant.priceMode !== ProductPriceMode.FORMULA) return null;
  const cny = variant.costPriceCny?.toNumber();
  const wkg = variant.weightKg?.toNumber();
  const vm3 = variant.volumeLiters?.toNumber();
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
    return null;
  }
  const { retailRub } = calcMskAndRetailRub(calcIn, {
    costPriceCny: cny,
    grossWeightKg: wkg,
    volumeM3: vm3,
  });
  return retailRub > 0 ? retailRub : null;
}

function variantDisplayPriceRub(
  variant: VariantForTier,
  tierApplies: boolean,
  tierCalcIn: PricingProfileCalcInput | null,
): number {
  if (tierApplies && tierCalcIn) {
    const tier = calcFormulaRetailRub(variant, tierCalcIn);
    if (tier != null) return tier;
  }
  return priceToNumber(variant.price);
}

type TierPricingContext = {
  tierProfile: NonNullable<Awaited<ReturnType<PricingAdminService['findProfileById']>>>;
  tierCalcIn: PricingProfileCalcInput;
};

/**
 * Фаза 3: tier-цены для участников группы с `pricingProfileId`.
 * FORMULA — пересчёт на лету; MANUAL — цена из БД.
 */
@Injectable()
export class CatalogTierPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingAdmin: PricingAdminService,
    private readonly profileResolver: UserGroupProfileResolverService,
  ) {}

  private async loadTierContext(userId?: string): Promise<TierPricingContext | null> {
    if (!userId?.trim()) return null;
    const profileId = await this.profileResolver.resolveGroupPricingProfileIdForUser(userId);
    if (!profileId) return null;
    const tierProfile = await this.pricingAdmin.findProfileById(profileId);
    if (!tierProfile) return null;
    return {
      tierProfile,
      tierCalcIn: this.pricingAdmin.profileToCalcInput(tierProfile),
    };
  }

  /** Цены вариантов с учётом tier-профиля группы (порядок как у `variants`). */
  resolveVariantDisplayPrices(
    tierContext: TierPricingContext | null,
    categoryId: string,
    productCategories: { categoryId: string }[],
    variants: VariantForTier[],
  ): number[] {
    if (!tierContext) {
      return variants.map((v) => priceToNumber(v.price));
    }
    const categoryIds = collectProductCategoryIds(categoryId, productCategories);
    const tierApplies = this.pricingAdmin.profileAppliesToCategoryIds(
      tierContext.tierProfile,
      categoryIds,
    );
    const tierCalc = tierApplies ? tierContext.tierCalcIn : null;
    return variants.map((v) => variantDisplayPriceRub(v, tierApplies, tierCalc));
  }

  async resolveVariantDisplayPricesForUser(
    userId: string | undefined,
    categoryId: string,
    productCategories: { categoryId: string }[],
    variants: VariantForTier[],
  ): Promise<number[]> {
    const tierContext = await this.loadTierContext(userId);
    return this.resolveVariantDisplayPrices(tierContext, categoryId, productCategories, variants);
  }

  /**
   * Цена строки черновика заказа: tier для FORMULA, фиксируется в `OrderItem.price`.
   */
  async resolveOrderLineUnitPriceRub(
    userId: string,
    productId: string,
    productVariantId: string | null,
    snapshot: Record<string, unknown> | null,
  ): Promise<number> {
    const variantSelect = {
      price: true,
      priceMode: true,
      costPriceCny: true,
      weightKg: true,
      volumeLiters: true,
      product: {
        select: {
          categoryId: true,
          productCategories: { select: { categoryId: true } },
        },
      },
    } as const;

    const priceForVariant = async (
      variant: VariantForTier & {
        product: { categoryId: string; productCategories: { categoryId: string }[] };
      },
    ): Promise<number> => {
      const [displayPrice] = await this.resolveVariantDisplayPricesForUser(
        userId,
        variant.product.categoryId,
        variant.product.productCategories,
        [variant],
      );
      return displayPrice > 0 ? displayPrice : priceToNumber(variant.price);
    };

    if (productVariantId) {
      const v = await this.prisma.productVariant.findFirst({
        where: { id: productVariantId, productId, isActive: true },
        select: variantSelect,
      });
      if (v) {
        const unit = await priceForVariant(v);
        if (unit > 0) return unit;
      }
    }

    const min = snapshot?.catalogPriceMinRub;
    const max = snapshot?.catalogPriceMaxRub;
    if (typeof min === 'number' && Number.isFinite(min) && min > 0) {
      return min;
    }
    if (typeof max === 'number' && Number.isFinite(max) && max > 0) {
      return max;
    }

    const def = await this.prisma.productVariant.findFirst({
      where: { productId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
      select: variantSelect,
    });
    if (def) {
      const unit = await priceForVariant(def);
      if (unit > 0) return unit;
    }
    return 0;
  }

  /**
   * Обогащает hits поиска/листинга: `price`, `priceMin`, `priceMax`, `sortPrice`.
   * Без userId или без tier-профиля — без изменений.
   */
  async enrichSearchHits<T extends Record<string, unknown>>(
    hits: T[],
    userId?: string,
  ): Promise<T[]> {
    if (!userId?.trim() || hits.length === 0) return hits;

    const tierContext = await this.loadTierContext(userId);
    if (!tierContext) return hits;

    const productIds = [
      ...new Set(
        hits
          .map((h) => h.id)
          .filter((id): id is string => typeof id === 'string' && !!id.trim()),
      ),
    ];
    if (!productIds.length) return hits;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: {
        id: true,
        categoryId: true,
        productCategories: { select: { categoryId: true } },
        variants: {
          where: { isActive: true },
          select: {
            price: true,
            priceMode: true,
            costPriceCny: true,
            weightKg: true,
            volumeLiters: true,
          },
        },
      },
    });

    const rangeByProductId = new Map<string, { min: number; max: number }>();
    for (const product of products) {
      const prices = this.resolveVariantDisplayPrices(
        tierContext,
        product.categoryId,
        product.productCategories,
        product.variants,
      ).filter((n) => n > 0);
      if (!prices.length) continue;
      rangeByProductId.set(product.id, {
        min: Math.min(...prices),
        max: Math.max(...prices),
      });
    }

    return hits.map((hit) => {
      const id = hit.id;
      if (typeof id !== 'string') return hit;
      const range = rangeByProductId.get(id);
      if (!range) return hit;
      return {
        ...hit,
        priceMin: range.min,
        priceMax: range.max,
        sortPrice: range.min,
        price: range.min,
      };
    });
  }
}
