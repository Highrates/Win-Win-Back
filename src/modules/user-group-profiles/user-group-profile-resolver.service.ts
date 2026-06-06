import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
  ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
  ORDER_PROGRAM_DEFAULTS,
} from '../order-settings/order-program.constants';
import {
  REFERRAL_CFG_LEVEL1_PERCENT,
  REFERRAL_CFG_LEVEL2_PERCENT,
  REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB,
  REFERRAL_PROGRAM_DEFAULTS,
} from '../referrals/referral-program.constants';

export type ResolvedReferralProgram = {
  profileId: string | null;
  enabled: boolean;
  level1Percent: number;
  level2Percent: number;
  minimumOrderSiteTotalRub: number;
};

export type ResolvedDesignerBonus = {
  profileId: string | null;
  designerOwnCatalogBonusPercent: number;
  designerOwnMinimumCatalogSiteTotalRub: number;
};

function parsePercent(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(100, n);
}

function parseMinRub(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Единая точка чтения профилей для runtime.
 * Фаза 1: всегда основной профиль (userId игнорируется).
 * Фаза 2: группа пользователя → профиль группы, иначе основной.
 */
@Injectable()
export class UserGroupProfileResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveReferralProgramForUser(_userId?: string): Promise<ResolvedReferralProgram> {
    const primary = await this.prisma.referralProgramProfile.findFirst({
      where: { isDefault: true },
    });
    if (primary) {
      return {
        profileId: primary.id,
        enabled: primary.enabled,
        level1Percent: primary.level1Percent.toNumber(),
        level2Percent: primary.level2Percent.toNumber(),
        minimumOrderSiteTotalRub: primary.minimumOrderSiteTotalRub,
      };
    }

    const rows = await this.prisma.referralConfig.findMany({
      where: {
        key: {
          in: [
            REFERRAL_CFG_LEVEL1_PERCENT,
            REFERRAL_CFG_LEVEL2_PERCENT,
            REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB,
          ],
        },
      },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const d1 = REFERRAL_PROGRAM_DEFAULTS[REFERRAL_CFG_LEVEL1_PERCENT] ?? '0';
    const d2 = REFERRAL_PROGRAM_DEFAULTS[REFERRAL_CFG_LEVEL2_PERCENT] ?? '0';
    const dmin = REFERRAL_PROGRAM_DEFAULTS[REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB] ?? '0';
    return {
      profileId: null,
      enabled: true,
      level1Percent: parsePercent(map[REFERRAL_CFG_LEVEL1_PERCENT], parsePercent(d1, 0)),
      level2Percent: parsePercent(map[REFERRAL_CFG_LEVEL2_PERCENT], parsePercent(d2, 0)),
      minimumOrderSiteTotalRub: parseMinRub(map[REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB] ?? dmin, 0),
    };
  }

  async resolveDesignerBonusForUser(_userId?: string): Promise<ResolvedDesignerBonus> {
    const primary = await this.prisma.designerBonusProfile.findFirst({
      where: { isDefault: true },
    });
    if (primary) {
      return {
        profileId: primary.id,
        designerOwnCatalogBonusPercent: primary.designerOwnCatalogBonusPercent.toNumber(),
        designerOwnMinimumCatalogSiteTotalRub: primary.designerOwnMinimumCatalogSiteTotalRub,
      };
    }

    const rows = await this.prisma.referralConfig.findMany({
      where: {
        key: {
          in: [
            ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
            ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
          ],
        },
      },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const dp = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT] ?? '0';
    const dm = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB] ?? '0';
    return {
      profileId: null,
      designerOwnCatalogBonusPercent: parsePercent(
        map[ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT],
        parsePercent(dp, 0),
      ),
      designerOwnMinimumCatalogSiteTotalRub: parseMinRub(
        map[ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB],
        parseMinRub(dm, 0),
      ),
    };
  }
}
