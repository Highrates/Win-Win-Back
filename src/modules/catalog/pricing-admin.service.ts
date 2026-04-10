import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calcMskAndRetailRub, type PricingProfileCalcInput } from './pricing-calculation';

export type PricingProfileAdminRow = {
  id: string;
  name: string;
  sortOrder: number;
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

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function rowToAdmin(p: {
  id: string;
  name: string;
  sortOrder: number;
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
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      include: { categories: { select: { categoryId: true } } },
    });
    return rows.map(rowToAdmin);
  }

  async createProfile(dto: UpsertPricingProfileDto): Promise<PricingProfileAdminRow> {
    await this.assertCategoriesExist(dto.categoryIds);
    await this.assertNoCategoryConflict(dto.categoryIds, undefined);
    this.assertContainer(dto.containerType);

    const cmw = this.normOptionalContainerMax(dto.containerMaxWeightKg);
    const cmv = this.normOptionalContainerMax(dto.containerMaxVolumeM3);
    this.assertContainerPair(cmw, cmv);

    const created = await this.prisma.pricingProfile.create({
      data: {
        name: (dto.name ?? '').trim(),
        sortOrder: 0,
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

  async updateProfile(id: string, dto: UpsertPricingProfileDto): Promise<PricingProfileAdminRow> {
    const existing = await this.prisma.pricingProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');

    await this.assertCategoriesExist(dto.categoryIds);
    await this.assertNoCategoryConflict(dto.categoryIds, id);
    this.assertContainer(dto.containerType);

    const cmw = this.normOptionalContainerMax(dto.containerMaxWeightKg);
    const cmv = this.normOptionalContainerMax(dto.containerMaxVolumeM3);
    this.assertContainerPair(cmw, cmv);

    await this.prisma.pricingProfileCategory.deleteMany({ where: { profileId: id } });

    const updated = await this.prisma.pricingProfile.update({
      where: { id },
      data: {
        name: (dto.name ?? '').trim(),
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
    return rowToAdmin(updated);
  }

  async deleteProfile(id: string): Promise<void> {
    try {
      await this.prisma.pricingProfile.delete({ where: { id } });
    } catch {
      throw new NotFoundException('Профиль не найден');
    }
  }

  /** Первый подходящий профиль по основной или доп. категории (самый свежий updatedAt). */
  async findProfileForCategoryIds(categoryIds: string[]) {
    const uniq = [...new Set(categoryIds.filter(Boolean))];
    if (!uniq.length) return null;
    return this.prisma.pricingProfile.findFirst({
      where: { categories: { some: { categoryId: { in: uniq } } } },
      orderBy: { updatedAt: 'desc' },
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

  private async assertNoCategoryConflict(categoryIds: string[], excludeProfileId?: string) {
    const uniq = [...new Set(categoryIds.filter(Boolean))];
    if (!uniq.length) return;
    const conflicts = await this.prisma.pricingProfileCategory.findMany({
      where: {
        categoryId: { in: uniq },
        ...(excludeProfileId ? { NOT: { profileId: excludeProfileId } } : {}),
      },
      select: { categoryId: true },
    });
    if (!conflicts.length) return;
    const conflictingCategoryIds = [...new Set(conflicts.map((c) => c.categoryId))];
    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Для выбранных категорий уже задан другой профиль ценообразования',
        conflictingCategoryIds,
      },
      HttpStatus.BAD_REQUEST,
    );
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
