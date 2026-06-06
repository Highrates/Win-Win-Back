import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ReferralProgramProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferralsService } from '../referrals/referrals.service';
import {
  REFERRAL_CFG_LEVEL1_PERCENT,
  REFERRAL_CFG_LEVEL2_PERCENT,
  REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB,
  REFERRAL_PROGRAM_DEFAULTS,
} from '../referrals/referral-program.constants';
import {
  referralProgramRewardsInputsChanged,
  referralProgramRewardsInputsFromProfile,
} from '../referrals/referral-program-rewards.util';
import { ProgramConfigSyncService } from './program-config-sync.service';
import type { UpsertReferralProgramProfileAdminDto } from './dto/referral-program-profile-admin.dto';

export type ReferralProgramProfileAdminRow = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  enabled: boolean;
  level1Percent: number;
  level2Percent: number;
  minimumOrderSiteTotalRub: number;
  createdAt: string;
  updatedAt: string;
};

function toRow(row: ReferralProgramProfile): ReferralProgramProfileAdminRow {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    enabled: row.enabled,
    level1Percent: row.level1Percent.toNumber(),
    level2Percent: row.level2Percent.toNumber(),
    minimumOrderSiteTotalRub: row.minimumOrderSiteTotalRub,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultPercent(key: string, fallback: number): number {
  const raw = REFERRAL_PROGRAM_DEFAULTS[key];
  const n = Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

@Injectable()
export class ReferralProgramProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referralsService: ReferralsService,
    private readonly configSync: ProgramConfigSyncService,
  ) {}

  async list(): Promise<ReferralProgramProfileAdminRow[]> {
    const rows = await this.prisma.referralProgramProfile.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRow);
  }

  private async resolveCreateRates(dto: UpsertReferralProgramProfileAdminDto): Promise<{
    level1Percent: number;
    level2Percent: number;
    minimumOrderSiteTotalRub: number;
  }> {
    if (
      dto.level1Percent !== undefined ||
      dto.level2Percent !== undefined ||
      dto.minimumOrderSiteTotalRub !== undefined
    ) {
      return {
        level1Percent: dto.level1Percent ?? defaultPercent(REFERRAL_CFG_LEVEL1_PERCENT, 5),
        level2Percent: dto.level2Percent ?? defaultPercent(REFERRAL_CFG_LEVEL2_PERCENT, 3),
        minimumOrderSiteTotalRub: dto.minimumOrderSiteTotalRub ?? 0,
      };
    }
    const primary = await this.prisma.referralProgramProfile.findFirst({ where: { isDefault: true } });
    if (primary) {
      return {
        level1Percent: primary.level1Percent.toNumber(),
        level2Percent: primary.level2Percent.toNumber(),
        minimumOrderSiteTotalRub: primary.minimumOrderSiteTotalRub,
      };
    }
    return {
      level1Percent: defaultPercent(REFERRAL_CFG_LEVEL1_PERCENT, 5),
      level2Percent: defaultPercent(REFERRAL_CFG_LEVEL2_PERCENT, 3),
      minimumOrderSiteTotalRub: defaultPercent(REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB, 0),
    };
  }

  async create(dto: UpsertReferralProgramProfileAdminDto): Promise<ReferralProgramProfileAdminRow> {
    const name = (dto.name ?? '').trim() || 'Новый профиль';
    const maxSort = await this.prisma.referralProgramProfile.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;
    const rates = await this.resolveCreateRates(dto);
    const created = await this.prisma.referralProgramProfile.create({
      data: {
        name,
        sortOrder,
        enabled: dto.enabled ?? true,
        isDefault: false,
        level1Percent: new Prisma.Decimal(rates.level1Percent),
        level2Percent: new Prisma.Decimal(rates.level2Percent),
        minimumOrderSiteTotalRub: rates.minimumOrderSiteTotalRub,
      },
    });
    return toRow(created);
  }

  private async setPrimaryProfile(id: string): Promise<void> {
    const existing = await this.prisma.referralProgramProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    await this.prisma.$transaction([
      this.prisma.referralProgramProfile.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.referralProgramProfile.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  async update(id: string, dto: UpsertReferralProgramProfileAdminDto): Promise<ReferralProgramProfileAdminRow> {
    const existing = await this.prisma.referralProgramProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');

    const previousPrimary = await this.prisma.referralProgramProfile.findFirst({
      where: { isDefault: true },
    });

    if (dto.setAsPrimary) {
      await this.setPrimaryProfile(id);
    }

    const level1 =
      dto.level1Percent !== undefined ? dto.level1Percent : existing.level1Percent.toNumber();
    const level2 =
      dto.level2Percent !== undefined ? dto.level2Percent : existing.level2Percent.toNumber();
    const minRub =
      dto.minimumOrderSiteTotalRub !== undefined
        ? dto.minimumOrderSiteTotalRub
        : existing.minimumOrderSiteTotalRub;

    const updated = await this.prisma.referralProgramProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || existing.name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.level1Percent !== undefined ? { level1Percent: new Prisma.Decimal(level1) } : {}),
        ...(dto.level2Percent !== undefined ? { level2Percent: new Prisma.Decimal(level2) } : {}),
        ...(dto.minimumOrderSiteTotalRub !== undefined
          ? { minimumOrderSiteTotalRub: minRub }
          : {}),
      },
    });

    if (updated.isDefault) {
      const beforeSource =
        dto.setAsPrimary && previousPrimary && previousPrimary.id !== updated.id
          ? previousPrimary
          : existing;
      const beforeInputs = referralProgramRewardsInputsFromProfile(beforeSource);
      const afterInputs = referralProgramRewardsInputsFromProfile(updated);
      if (referralProgramRewardsInputsChanged(beforeInputs, afterInputs)) {
        await this.configSync.mirrorReferralProgram({
          level1Percent: afterInputs.level1Percent,
          level2Percent: afterInputs.level2Percent,
          minimumOrderSiteTotalRub: afterInputs.minimumOrderSiteTotalRub,
        });
      }
      await this.referralsService.recalculateRewardsIfProgramChanged(beforeInputs, afterInputs);
    }

    return toRow(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.referralProgramProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    if (existing.isDefault) {
      throw new BadRequestException('Нельзя удалить основной профиль');
    }
    await this.prisma.referralProgramProfile.delete({ where: { id } });
  }
}
