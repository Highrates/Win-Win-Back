import { Injectable } from '@nestjs/common';
import type { DesignerBonusProfile, ReferralProgramProfile } from '@prisma/client';
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

function mapReferralProfile(row: ReferralProgramProfile): ResolvedReferralProgram {
  return {
    profileId: row.id,
    enabled: row.enabled,
    level1Percent: row.level1Percent.toNumber(),
    level2Percent: row.level2Percent.toNumber(),
    minimumOrderSiteTotalRub: row.minimumOrderSiteTotalRub,
  };
}

function mapDesignerBonusProfile(row: DesignerBonusProfile): ResolvedDesignerBonus {
  return {
    profileId: row.id,
    designerOwnCatalogBonusPercent: row.designerOwnCatalogBonusPercent.toNumber(),
    designerOwnMinimumCatalogSiteTotalRub: row.designerOwnMinimumCatalogSiteTotalRub,
  };
}

/**
 * Единая точка чтения профилей для runtime.
 * Фаза 2: группа пользователя → профиль группы, иначе основной (isDefault).
 */
@Injectable()
export class UserGroupProfileResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserGroupLabel(userId: string): Promise<string | null> {
    const member = await this.prisma.userGroupMember.findUnique({
      where: { userId },
      include: { group: { select: { label: true } } },
    });
    const label = member?.group.label?.trim();
    return label || null;
  }

  /** `pricingProfileId` группы пользователя; null — tier-цены витрины не применяются. */
  async resolveGroupPricingProfileIdForUser(userId: string): Promise<string | null> {
    const member = await this.prisma.userGroupMember.findUnique({
      where: { userId },
      include: { group: { select: { pricingProfileId: true } } },
    });
    const id = member?.group.pricingProfileId?.trim();
    return id || null;
  }

  async resolveReferralProgramByProfileId(profileId: string): Promise<ResolvedReferralProgram | null> {
    const row = await this.prisma.referralProgramProfile.findUnique({ where: { id: profileId } });
    return row ? mapReferralProfile(row) : null;
  }

  async resolveDesignerBonusByProfileId(profileId: string): Promise<ResolvedDesignerBonus | null> {
    const row = await this.prisma.designerBonusProfile.findUnique({ where: { id: profileId } });
    return row ? mapDesignerBonusProfile(row) : null;
  }

  /**
   * Контекст покупателя для заказа: enabled и min сумма.
   * Снимок на Order (если есть) фиксирует профиль на момент отправки.
   */
  async resolveBuyerReferralOrderContext(order: {
    userId: string;
    buyerReferralProgramProfileIdSnapshot: string | null;
  }): Promise<Pick<ResolvedReferralProgram, 'profileId' | 'enabled' | 'minimumOrderSiteTotalRub'>> {
    if (order.buyerReferralProgramProfileIdSnapshot) {
      const snap = await this.resolveReferralProgramByProfileId(order.buyerReferralProgramProfileIdSnapshot);
      if (snap) {
        return {
          profileId: snap.profileId,
          enabled: snap.enabled,
          minimumOrderSiteTotalRub: snap.minimumOrderSiteTotalRub,
        };
      }
    }
    const live = await this.resolveReferralProgramForUser(order.userId);
    return {
      profileId: live.profileId,
      enabled: live.enabled,
      minimumOrderSiteTotalRub: live.minimumOrderSiteTotalRub,
    };
  }

  async resolveDesignerBonusForOrder(order: {
    userId: string;
    buyerDesignerBonusProfileIdSnapshot: string | null;
  }): Promise<ResolvedDesignerBonus> {
    if (order.buyerDesignerBonusProfileIdSnapshot) {
      const snap = await this.resolveDesignerBonusByProfileId(order.buyerDesignerBonusProfileIdSnapshot);
      if (snap) return snap;
    }
    return this.resolveDesignerBonusForUser(order.userId);
  }

  async resolveReferralProgramForUser(userId?: string): Promise<ResolvedReferralProgram> {
    if (userId) {
      const member = await this.prisma.userGroupMember.findUnique({
        where: { userId },
        include: { group: { include: { referralProgramProfile: true } } },
      });
      if (member?.group.referralProgramProfile) {
        return mapReferralProfile(member.group.referralProgramProfile);
      }
    }
    return this.resolveDefaultReferralProgram();
  }

  async resolveDesignerBonusForUser(userId?: string): Promise<ResolvedDesignerBonus> {
    if (userId) {
      const member = await this.prisma.userGroupMember.findUnique({
        where: { userId },
        include: { group: { include: { designerBonusProfile: true } } },
      });
      if (member?.group.designerBonusProfile) {
        return mapDesignerBonusProfile(member.group.designerBonusProfile);
      }
    }
    return this.resolveDefaultDesignerBonus();
  }

  private async resolveDefaultReferralProgram(): Promise<ResolvedReferralProgram> {
    const primary = await this.prisma.referralProgramProfile.findFirst({
      where: { isDefault: true },
    });
    if (primary) {
      return mapReferralProfile(primary);
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

  private async resolveDefaultDesignerBonus(): Promise<ResolvedDesignerBonus> {
    const primary = await this.prisma.designerBonusProfile.findFirst({
      where: { isDefault: true },
    });
    if (primary) {
      return mapDesignerBonusProfile(primary);
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
