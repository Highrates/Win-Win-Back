import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calcMskAndRetailRub,
  type PricingProfileCalcInput,
} from './pricing-calculation';
import {
  batchForwardRetailFromProfileCalc,
  forwardRetailFromProfileCalc,
  reverseRetailToCnyFromProfileCalc,
  type SourcingKpForwardLineInput,
} from './sourcing-kp-pricing-calc';

export type PricingProfileAdminRow = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  containerType: string;
  cnyRate: string;
  usdRate: string;
  eurRate: string;
  transferCommissionPct: string;
  customsAdValoremPct: string;
  customsWeightPct: string;
  vatPct: string;
  markupPct: string;
  agentRub: string;
  warehousePortUsd: string;
  fobUsd: string;
  portMskRub: string;
  extraLogisticsRub: string;
  containerMaxWeightKg: string | null;
  containerMaxVolumeM3: string | null;
  categoryIds: string[];
  updatedAt: string;
};

export type UpsertPricingProfileDto = {
  name?: string;
  containerType: string;
  cnyRate: number;
  usdRate: number;
  eurRate: number;
  transferCommissionPct: number;
  customsAdValoremPct: number;
  customsWeightPct: number;
  vatPct: number;
  markupPct: number;
  agentRub: number;
  warehousePortUsd: number;
  fobUsd: number;
  portMskRub: number;
  extraLogisticsRub: number;
  containerMaxWeightKg?: number | null;
  containerMaxVolumeM3?: number | null;
  categoryIds: string[];
};

export type PatchPricingProfileDto = Partial<UpsertPricingProfileDto> & {
  setAsPrimary?: boolean;
};

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function rowToAdmin(p: {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  containerType: string;
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
  containerMaxWeightKg: Prisma.Decimal | null;
  containerMaxVolumeM3: Prisma.Decimal | null;
  updatedAt: Date;
  categories: { categoryId: string }[];
}): PricingProfileAdminRow {
  return {
    id: p.id,
    name: p.name,
    sortOrder: p.sortOrder,
    isDefault: p.isDefault,
    containerType: p.containerType,
    cnyRate: p.cnyRate.toString(),
    usdRate: p.usdRate.toString(),
    eurRate: p.eurRate.toString(),
    transferCommissionPct: p.transferCommissionPct.toString(),
    customsAdValoremPct: p.customsAdValoremPct.toString(),
    customsWeightPct: p.customsWeightPct.toString(),
    vatPct: p.vatPct.toString(),
    markupPct: p.markupPct.toString(),
    agentRub: p.agentRub.toString(),
    warehousePortUsd: p.warehousePortUsd.toString(),
    fobUsd: p.fobUsd.toString(),
    portMskRub: p.portMskRub.toString(),
    extraLogisticsRub: p.extraLogisticsRub.toString(),
    containerMaxWeightKg: p.containerMaxWeightKg?.toString() ?? null,
    containerMaxVolumeM3: p.containerMaxVolumeM3?.toString() ?? null,
    categoryIds: p.categories.map((c) => c.categoryId),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class PricingAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(): Promise<PricingProfileAdminRow[]> {
    const rows = await this.prisma.pricingProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      include: { categories: { select: { categoryId: true } } },
    });
    return rows.map(rowToAdmin);
  }

  async createProfile(dto: UpsertPricingProfileDto): Promise<PricingProfileAdminRow> {
    await this.assertCategoriesExist(dto.categoryIds);
    this.assertContainer(dto.containerType);

    const cmw = this.normOptionalContainerMax(dto.containerMaxWeightKg);
    const cmv = this.normOptionalContainerMax(dto.containerMaxVolumeM3);
    this.assertContainerPair(cmw, cmv);

    const existingCount = await this.prisma.pricingProfile.count();
    const created = await this.prisma.pricingProfile.create({
      data: {
        name: (dto.name ?? '').trim(),
        sortOrder: 0,
        isDefault: existingCount === 0,
        containerType: dto.containerType.trim(),
        containerMaxWeightKg: cmw,
        containerMaxVolumeM3: cmv,
        cnyRate: d(dto.cnyRate),
        usdRate: d(dto.usdRate),
        eurRate: d(dto.eurRate),
        transferCommissionPct: d(dto.transferCommissionPct),
        customsAdValoremPct: d(dto.customsAdValoremPct),
        customsWeightPct: d(dto.customsWeightPct),
        vatPct: d(dto.vatPct),
        markupPct: d(dto.markupPct),
        agentRub: d(dto.agentRub),
        warehousePortUsd: d(dto.warehousePortUsd),
        fobUsd: d(dto.fobUsd),
        portMskRub: d(dto.portMskRub),
        extraLogisticsRub: d(dto.extraLogisticsRub),
        categories: {
          create: dto.categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: { categories: { select: { categoryId: true } } },
    });
    return rowToAdmin(created);
  }

  async updateProfile(id: string, dto: PatchPricingProfileDto): Promise<PricingProfileAdminRow> {
    const existing = await this.prisma.pricingProfile.findUnique({
      where: { id },
      include: { categories: { select: { categoryId: true } } },
    });
    if (!existing) throw new NotFoundException('Профиль не найден');

    if (dto.setAsPrimary) {
      await this.setPrimaryProfile(id);
    }

    const categoryIds = dto.categoryIds ?? existing.categories.map((c) => c.categoryId);
    const containerType = dto.containerType ?? existing.containerType;
    const hasFieldPatch =
      dto.categoryIds !== undefined ||
      dto.containerType !== undefined ||
      dto.name !== undefined ||
      dto.cnyRate !== undefined ||
      dto.usdRate !== undefined ||
      dto.eurRate !== undefined ||
      dto.transferCommissionPct !== undefined ||
      dto.customsAdValoremPct !== undefined ||
      dto.customsWeightPct !== undefined ||
      dto.vatPct !== undefined ||
      dto.markupPct !== undefined ||
      dto.agentRub !== undefined ||
      dto.warehousePortUsd !== undefined ||
      dto.fobUsd !== undefined ||
      dto.portMskRub !== undefined ||
      dto.extraLogisticsRub !== undefined ||
      dto.containerMaxWeightKg !== undefined ||
      dto.containerMaxVolumeM3 !== undefined;

    if (!hasFieldPatch) {
      const refreshed = await this.prisma.pricingProfile.findUnique({
        where: { id },
        include: { categories: { select: { categoryId: true } } },
      });
      return rowToAdmin(refreshed!);
    }

    await this.assertCategoriesExist(categoryIds);
    this.assertContainer(containerType);

    const cmw =
      dto.containerMaxWeightKg !== undefined
        ? this.normOptionalContainerMax(dto.containerMaxWeightKg)
        : existing.containerMaxWeightKg;
    const cmv =
      dto.containerMaxVolumeM3 !== undefined
        ? this.normOptionalContainerMax(dto.containerMaxVolumeM3)
        : existing.containerMaxVolumeM3;
    this.assertContainerPair(cmw, cmv);

    if (dto.categoryIds !== undefined) {
      await this.prisma.pricingProfileCategory.deleteMany({ where: { profileId: id } });
    }

    const updated = await this.prisma.pricingProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        containerType: containerType.trim(),
        containerMaxWeightKg: cmw,
        containerMaxVolumeM3: cmv,
        ...(dto.cnyRate !== undefined ? { cnyRate: d(dto.cnyRate) } : {}),
        ...(dto.usdRate !== undefined ? { usdRate: d(dto.usdRate) } : {}),
        ...(dto.eurRate !== undefined ? { eurRate: d(dto.eurRate) } : {}),
        ...(dto.transferCommissionPct !== undefined
          ? { transferCommissionPct: d(dto.transferCommissionPct) }
          : {}),
        ...(dto.customsAdValoremPct !== undefined
          ? { customsAdValoremPct: d(dto.customsAdValoremPct) }
          : {}),
        ...(dto.customsWeightPct !== undefined
          ? { customsWeightPct: d(dto.customsWeightPct) }
          : {}),
        ...(dto.vatPct !== undefined ? { vatPct: d(dto.vatPct) } : {}),
        ...(dto.markupPct !== undefined ? { markupPct: d(dto.markupPct) } : {}),
        ...(dto.agentRub !== undefined ? { agentRub: d(dto.agentRub) } : {}),
        ...(dto.warehousePortUsd !== undefined
          ? { warehousePortUsd: d(dto.warehousePortUsd) }
          : {}),
        ...(dto.fobUsd !== undefined ? { fobUsd: d(dto.fobUsd) } : {}),
        ...(dto.portMskRub !== undefined ? { portMskRub: d(dto.portMskRub) } : {}),
        ...(dto.extraLogisticsRub !== undefined
          ? { extraLogisticsRub: d(dto.extraLogisticsRub) }
          : {}),
        ...(dto.categoryIds !== undefined
          ? {
              categories: {
                create: categoryIds.map((categoryId) => ({ categoryId })),
              },
            }
          : {}),
      },
      include: { categories: { select: { categoryId: true } } },
    });
    return rowToAdmin(updated);
  }

  async deleteProfile(id: string): Promise<void> {
    const existing = await this.prisma.pricingProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    if (existing.isDefault) {
      throw new BadRequestException('Нельзя удалить основной профиль');
    }
    await this.prisma.pricingProfile.delete({ where: { id } });
  }

  private async setPrimaryProfile(id: string): Promise<void> {
    const existing = await this.prisma.pricingProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    await this.prisma.$transaction([
      this.prisma.pricingProfile.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.pricingProfile.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  async findProfileById(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return null;
    return this.prisma.pricingProfile.findUnique({
      where: { id: trimmed },
      include: { categories: { select: { categoryId: true } } },
    });
  }

  /** Профиль группы применим к товару, если пересекаются categoryIds. */
  profileAppliesToCategoryIds(
    profile: { categories: { categoryId: string }[] },
    categoryIds: string[],
  ): boolean {
    const productCats = new Set(categoryIds.filter(Boolean));
    if (!productCats.size) return false;
    return profile.categories.some((c) => productCats.has(c.categoryId));
  }

  profileToCalcInput(row: {
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
    return this.profileEntityToCalc(row);
  }

  /** Основной профиль (isDefault) — для заявок на подбор без категории. */
  async findDefaultProfile() {
    return this.prisma.pricingProfile.findFirst({
      where: { isDefault: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Загрузить основной профиль один раз для пакетного расчёта КП. */
  async loadDefaultProfileCalcContext(): Promise<
    | { ok: true; calcIn: PricingProfileCalcInput; profileUpdatedAt: Date }
    | { ok: false; error: 'NO_PROFILE' }
  > {
    const profile = await this.findDefaultProfile();
    if (!profile) return { ok: false, error: 'NO_PROFILE' };
    return {
      ok: true,
      calcIn: this.profileEntityToCalc(profile),
      profileUpdatedAt: profile.updatedAt,
    };
  }

  batchForwardRetailFromProfileCalc(
    calcIn: PricingProfileCalcInput,
    lines: SourcingKpForwardLineInput[],
  ) {
    return batchForwardRetailFromProfileCalc(calcIn, lines);
  }

  forwardRetailFromProfileCalc(
    calcIn: PricingProfileCalcInput,
    dto: SourcingKpForwardLineInput,
  ) {
    return forwardRetailFromProfileCalc(calcIn, dto);
  }

  reverseRetailToCnyFromProfileCalc(
    calcIn: PricingProfileCalcInput,
    dto: { retailRub: number; weightKg?: number; volumeM3?: number },
  ) {
    return reverseRetailToCnyFromProfileCalc(calcIn, dto);
  }

  /** Основной профиль (isDefault) по пересечению категорий — для гостей и пользователей без группы. */
  async findProfileForCategoryIds(categoryIds: string[]) {
    const uniq = [...new Set(categoryIds.filter(Boolean))];
    if (!uniq.length) return null;
    return this.prisma.pricingProfile.findFirst({
      where: {
        isDefault: true,
        categories: { some: { categoryId: { in: uniq } } },
      },
      include: { categories: { select: { categoryId: true } } },
    });
  }

  /** Онлайн-расчёт цены для админки товара. */
  async previewRetailPrice(dto: {
    categoryIds: string[];
    costPriceCny: number;
    weightKg: number;
    volumeM3: number;
  }): Promise<
    | { ok: true; retailRub: number; mskRub: number }
    | { ok: false; error: 'NO_PROFILE' | 'INVALID_INPUT' }
  > {
    const { categoryIds, costPriceCny, weightKg, volumeM3 } = dto;
    if (
      !Number.isFinite(costPriceCny) ||
      costPriceCny <= 0 ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0 ||
      !Number.isFinite(volumeM3) ||
      volumeM3 <= 0
    ) {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    const profile = await this.findProfileForCategoryIds(categoryIds);
    if (!profile) return { ok: false, error: 'NO_PROFILE' };

    const calcIn = this.profileEntityToCalc(profile);
    const { retailRub, mskRub } = calcMskAndRetailRub(calcIn, {
      costPriceCny,
      grossWeightKg: weightKg,
      volumeM3,
    });
    return { ok: true, retailRub, mskRub };
  }

  /** Прямой расчёт розницы ₽ из ¥ по основному профилю (КП заявки на подбор). */
  async forwardRetailFromDefaultProfile(dto: {
    costPriceCny: number;
    weightKg: number;
    volumeM3: number;
  }): Promise<
    | { ok: true; retailRub: number; mskRub: number; shareS: number }
    | { ok: false; error: 'NO_PROFILE' | 'INVALID_INPUT' }
  > {
    const ctx = await this.loadDefaultProfileCalcContext();
    if (!ctx.ok) return { ok: false, error: 'NO_PROFILE' };
    const forward = forwardRetailFromProfileCalc(ctx.calcIn, dto);
    if (!forward.ok) return { ok: false, error: 'INVALID_INPUT' };
    return forward;
  }

  /** Пакетный прямой расчёт ₽ по основному профилю (превью КП). */
  async batchForwardRetailFromDefaultProfile(lines: SourcingKpForwardLineInput[]): Promise<
    | {
        ok: true;
        results: Array<
          | { ok: true; retailRub: number; mskRub: number; shareS: number }
          | { ok: false; error: 'INVALID_INPUT' }
        >;
      }
    | { ok: false; error: 'NO_PROFILE' }
  > {
    const ctx = await this.loadDefaultProfileCalcContext();
    if (!ctx.ok) return { ok: false, error: 'NO_PROFILE' };
    return { ok: true, results: this.batchForwardRetailFromProfileCalc(ctx.calcIn, lines) };
  }

  /** Обратный расчёт ¥ из розничного бюджета (заявка на подбор, админка).
   *  ¥ считается по типовым габаритам (30 кг / 0,15 м³); вес и объём из запроса
   *  используются для прямой проверки — укладывается ли бюджет при этих габаритах. */
  async reverseRetailToCny(dto: {
    retailRub: number;
    weightKg?: number;
    volumeM3?: number;
  }): Promise<
    | {
        ok: true;
        costPriceCny: number;
        mskRub: number;
        retailRub: number;
        retailAtDims: number;
        fitsBudget: boolean;
        shareS: number;
        weightKg: number;
        volumeM3: number;
        typicalWeightKg: number;
        typicalVolumeM3: number;
      }
    | { ok: false; error: 'NO_PROFILE' | 'INVALID_INPUT' | 'NEGATIVE_CNY' }
  > {
    const ctx = await this.loadDefaultProfileCalcContext();
    if (!ctx.ok) return { ok: false, error: 'NO_PROFILE' };
    const reverse = reverseRetailToCnyFromProfileCalc(ctx.calcIn, dto);
    if (!reverse.ok) return reverse;
    return reverse;
  }

  private profileEntityToCalc(row: {
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
      containerType: row.containerType,
      containerMaxWeightKg: row.containerMaxWeightKg?.toNumber() ?? null,
      containerMaxVolumeM3: row.containerMaxVolumeM3?.toNumber() ?? null,
      cnyRate: row.cnyRate.toNumber(),
      usdRate: row.usdRate.toNumber(),
      eurRate: row.eurRate.toNumber(),
      transferCommissionPct: row.transferCommissionPct.toNumber(),
      customsAdValoremPct: row.customsAdValoremPct.toNumber(),
      customsWeightPct: row.customsWeightPct.toNumber(),
      vatPct: row.vatPct.toNumber(),
      markupPct: row.markupPct.toNumber(),
      agentRub: row.agentRub.toNumber(),
      warehousePortUsd: row.warehousePortUsd.toNumber(),
      fobUsd: row.fobUsd.toNumber(),
      portMskRub: row.portMskRub.toNumber(),
      extraLogisticsRub: row.extraLogisticsRub.toNumber(),
    };
  }

  private normOptionalContainerMax(raw: number | null | undefined): Prisma.Decimal | null {
    if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
    return new Prisma.Decimal(raw);
  }

  /** Оба заданы или оба пустые (тогда берутся стандартные 40'/20'). */
  private assertContainerPair(
    w: Prisma.Decimal | null,
    v: Prisma.Decimal | null,
  ): void {
    const hasW = w != null;
    const hasV = v != null;
    if (hasW !== hasV) {
      throw new BadRequestException(
        'Укажите оба параметра контейнера (max вес и max объём) или оставьте оба пустыми',
      );
    }
  }

  private assertContainer(t: string) {
    const s = String(t).trim();
    if (s !== '40' && s !== '20') {
      throw new BadRequestException('containerType должен быть "40" или "20"');
    }
  }

  private async assertCategoriesExist(ids: string[]) {
    if (!ids.length) {
      throw new BadRequestException('Выберите хотя бы одну категорию');
    }
    const rows = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException('Некоторые категории не найдены');
    }
  }
}
