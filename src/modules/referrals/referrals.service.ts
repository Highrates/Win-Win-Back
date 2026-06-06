import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderSettingsService } from '../order-settings/order-settings.service';
import { ProgramConfigSyncService } from '../user-group-profiles/program-config-sync.service';
import {
  UserGroupProfileResolverService,
  type ResolvedReferralProgram,
} from '../user-group-profiles/user-group-profile-resolver.service';
import type { UpdateReferralProgramAdminDto } from './dto/referral-program-admin.dto';
import {
  referralProgramRewardsInputsChanged,
  type ReferralProgramRewardsInputs,
} from './referral-program-rewards.util';

const LOG = new Logger('ReferralsService');

export type PartnerProgramBonusLineDto = {
  orderId: string;
  orderUpdatedAt: string;
  catalogTotalRub: string;
  purchaserUserId: string;
  tier: 1 | 2;
  percentApplied: number;
  bonusRub: string;
  orderStatus: OrderStatus;
  pipeline: boolean;
  /** Собственные завершённые заказы партнёра (бонус «со своего заказа»), не реферальные L1/L2. */
  source?: 'REFERRAL' | 'OWN_ORDER';
};

export type PartnerProgramSummaryDto = {
  program: {
    enabled: boolean;
    level1Percent: number;
    level2Percent: number;
    minimumOrderSiteTotalRub: number;
    basisNote: 'SITE_CATALOG_LINE_PRICES';
  };
  totals: {
    personalPipelineRub: string;
    personalCompletedRub: string;
    teamPipelineRub: string;
    teamCompletedRub: string;
    payableFromCompletedRub: string;
    pipelineOutlookRub: string;
  };
  personalLines: PartnerProgramBonusLineDto[];
  teamLines: PartnerProgramBonusLineDto[];
};

function catalogTotalFromItems(items: { price: Prisma.Decimal; quantity: number }[]): Prisma.Decimal {
  let sum = new Prisma.Decimal(0);
  for (const it of items) {
    sum = sum.add(new Prisma.Decimal(it.price).mul(Math.max(1, it.quantity)));
  }
  return sum;
}

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private orderSettings: OrderSettingsService,
    private profileResolver: UserGroupProfileResolverService,
    private configSync: ProgramConfigSyncService,
  ) {}

  async getConfig() {
    const rows = await this.prisma.referralConfig.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async getAdminProgramConfig(): Promise<{
    enabled: boolean;
    level1Percent: number;
    level2Percent: number;
    minimumOrderSiteTotalRub: number;
  }> {
    const cfg = await this.profileResolver.resolveReferralProgramForUser();
    return {
      enabled: cfg.enabled,
      level1Percent: cfg.level1Percent,
      level2Percent: cfg.level2Percent,
      minimumOrderSiteTotalRub: cfg.minimumOrderSiteTotalRub,
    };
  }

  async updateAdminProgramConfig(dto: UpdateReferralProgramAdminDto): Promise<void> {
    const before = await this.profileResolver.resolveReferralProgramForUser();
    const primary = await this.prisma.referralProgramProfile.findFirst({ where: { isDefault: true } });
    if (primary) {
      await this.prisma.referralProgramProfile.update({
        where: { id: primary.id },
        data: {
          level1Percent: new Prisma.Decimal(dto.level1Percent),
          level2Percent: new Prisma.Decimal(dto.level2Percent),
          minimumOrderSiteTotalRub: dto.minimumOrderSiteTotalRub,
        },
      });
    }
    await this.configSync.mirrorReferralProgram({
      level1Percent: dto.level1Percent,
      level2Percent: dto.level2Percent,
      minimumOrderSiteTotalRub: dto.minimumOrderSiteTotalRub,
    });
    const after: ReferralProgramRewardsInputs = {
      enabled: before.enabled,
      level1Percent: dto.level1Percent,
      level2Percent: dto.level2Percent,
      minimumOrderSiteTotalRub: dto.minimumOrderSiteTotalRub,
    };
    await this.recalculateRewardsIfProgramChanged(before, after);
  }

  /** Полный пересчёт только если изменились поля, влияющие на ReferralReward. */
  async recalculateRewardsIfProgramChanged(
    before: ReferralProgramRewardsInputs,
    after: ReferralProgramRewardsInputs,
  ): Promise<void> {
    if (!referralProgramRewardsInputsChanged(before, after)) {
      LOG.log('referral rewards recalc skipped: program inputs unchanged');
      return;
    }
    await this.recalculateRewardsForAllCompletedOrders();
  }

  private async buildBuyerTierMap(partnerId: string): Promise<Map<string, 1 | 2>> {
    const l1Rows = await this.prisma.referral.findMany({
      where: { referrerId: partnerId },
      select: { referredId: true },
    });
    const l1Ids = l1Rows.map((r) => r.referredId);
    const tierByBuyer = new Map<string, 1 | 2>();
    for (const id of l1Ids) tierByBuyer.set(id, 1);
    if (l1Ids.length === 0) return tierByBuyer;
    const l2Rows = await this.prisma.referral.findMany({
      where: { referrerId: { in: l1Ids } },
      select: { referredId: true },
    });
    for (const r of l2Rows) {
      if (!tierByBuyer.has(r.referredId)) tierByBuyer.set(r.referredId, 2);
    }
    return tierByBuyer;
  }

  private computeLineBonus(
    catalog: Prisma.Decimal,
    minRub: number,
    tier: 1 | 2,
    level1Percent: number,
    level2Percent: number,
  ): { bonus: Prisma.Decimal; percent: number } {
    const minD = new Prisma.Decimal(minRub);
    if (catalog.lt(minD)) {
      return { bonus: new Prisma.Decimal(0), percent: tier === 1 ? level1Percent : level2Percent };
    }
    const pct = tier === 1 ? level1Percent : level2Percent;
    const bonus = catalog.mul(new Prisma.Decimal(pct)).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { bonus, percent: pct };
  }

  async getPartnerProgramSummary(partnerUserId: string): Promise<PartnerProgramSummaryDto> {
    const p = await this.prisma.userProfile.findUnique({
      where: { userId: partnerUserId },
      select: { winWinPartnerApproved: true },
    });
    if (!p?.winWinPartnerApproved) {
      throw new ForbiddenException('Раздел дохода доступен одобренным партнёрам Win-Win');
    }

    const partnerProgram = await this.profileResolver.resolveReferralProgramForUser(partnerUserId);
    const ownOrderCfg = await this.orderSettings.getResolved(partnerUserId);
    const tierByBuyer = await this.buildBuyerTierMap(partnerUserId);
    const buyerIds = [...tierByBuyer.keys()];
    const buyerProgramCache = new Map<string, ResolvedReferralProgram>();

    const orders =
      buyerIds.length > 0
        ? await this.prisma.order.findMany({
            where: {
              userId: { in: buyerIds },
              status: { not: OrderStatus.DRAFT },
            },
            include: { items: { select: { price: true, quantity: true } } },
            orderBy: { updatedAt: 'desc' },
            take: 120,
          })
        : [];

    const personalLines: PartnerProgramBonusLineDto[] = [];
    const teamLines: PartnerProgramBonusLineDto[] = [];

    let personalPipeline = new Prisma.Decimal(0);
    let personalCompleted = new Prisma.Decimal(0);
    let teamPipeline = new Prisma.Decimal(0);
    let teamCompleted = new Prisma.Decimal(0);

    for (const o of orders) {
      const buyerId = o.userId;
      if (buyerId === partnerUserId) continue;
      const tier = tierByBuyer.get(buyerId);
      if (!tier) continue;

      let buyerProgram = buyerProgramCache.get(buyerId);
      if (!buyerProgram) {
        buyerProgram = await this.profileResolver.resolveReferralProgramForUser(buyerId);
        buyerProgramCache.set(buyerId, buyerProgram);
      }
      if (!buyerProgram.enabled) continue;

      const catalog = catalogTotalFromItems(o.items);
      const { bonus, percent } = this.computeLineBonus(
        catalog,
        buyerProgram.minimumOrderSiteTotalRub,
        tier,
        buyerProgram.level1Percent,
        buyerProgram.level2Percent,
      );
      const pipeline = o.status !== OrderStatus.COMPLETED;

      const row: PartnerProgramBonusLineDto = {
        orderId: o.id,
        orderUpdatedAt: o.updatedAt.toISOString(),
        catalogTotalRub: catalog.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
        purchaserUserId: buyerId,
        tier,
        percentApplied: percent,
        bonusRub: bonus.toFixed(2),
        orderStatus: o.status,
        pipeline,
        source: 'REFERRAL',
      };
      if (tier === 1) {
        personalLines.push(row);
        if (pipeline) personalPipeline = personalPipeline.add(bonus);
        else personalCompleted = personalCompleted.add(bonus);
      } else {
        teamLines.push(row);
        if (pipeline) teamPipeline = teamPipeline.add(bonus);
        else teamCompleted = teamCompleted.add(bonus);
      }
    }

    const ownOrders = await this.prisma.order.findMany({
      where: { userId: partnerUserId, status: OrderStatus.COMPLETED },
      include: { items: { select: { price: true, quantity: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 120,
    });
    for (const o of ownOrders) {
      const catalog = catalogTotalFromItems(o.items);
      const bonus = this.orderSettings.computeDesignerOwnCatalogBonusRub(ownOrderCfg, catalog);
      const pct = ownOrderCfg.designerOwnCatalogBonusPercent;
      personalLines.push({
        orderId: o.id,
        orderUpdatedAt: o.updatedAt.toISOString(),
        catalogTotalRub: catalog.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
        purchaserUserId: partnerUserId,
        tier: 1,
        percentApplied: pct,
        bonusRub: bonus.toFixed(2),
        orderStatus: o.status,
        pipeline: false,
        source: 'OWN_ORDER',
      });
      personalCompleted = personalCompleted.add(bonus);
    }

    const cmpUpdated = (a: PartnerProgramBonusLineDto, b: PartnerProgramBonusLineDto) =>
      Date.parse(b.orderUpdatedAt) - Date.parse(a.orderUpdatedAt);
    personalLines.sort(cmpUpdated);
    teamLines.sort(cmpUpdated);

    const payableFromCompleted = personalCompleted.add(teamCompleted);
    const pipelineOutlook = personalPipeline.add(teamPipeline);

    return {
      program: {
        enabled: partnerProgram.enabled,
        level1Percent: partnerProgram.level1Percent,
        level2Percent: partnerProgram.level2Percent,
        minimumOrderSiteTotalRub: partnerProgram.minimumOrderSiteTotalRub,
        basisNote: 'SITE_CATALOG_LINE_PRICES',
      },
      totals: {
        personalPipelineRub: personalPipeline.toFixed(2),
        personalCompletedRub: personalCompleted.toFixed(2),
        teamPipelineRub: teamPipeline.toFixed(2),
        teamCompletedRub: teamCompleted.toFixed(2),
        payableFromCompletedRub: payableFromCompleted.toFixed(2),
        pipelineOutlookRub: pipelineOutlook.toFixed(2),
      },
      personalLines,
      teamLines,
    };
  }

  async ensureRewardsForCompletedOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { price: true, quantity: true } } },
    });
    if (!order || order.status !== OrderStatus.COMPLETED) return;

    const buyerId = order.userId;
    const cfg = await this.profileResolver.resolveReferralProgramForUser(buyerId);
    if (!cfg.enabled) {
      await this.prisma.referralReward.deleteMany({ where: { orderId } });
      return;
    }

    const catalog = catalogTotalFromItems(order.items);

    const receivers = new Map<string, 1 | 2>();

    const up1 = await this.prisma.referral.findFirst({
      where: { referredId: buyerId },
      select: { referrerId: true },
    });
    if (up1?.referrerId && up1.referrerId !== buyerId) {
      receivers.set(up1.referrerId, 1);
      const up2 = await this.prisma.referral.findFirst({
        where: { referredId: up1.referrerId },
        select: { referrerId: true },
      });
      if (up2?.referrerId && up2.referrerId !== buyerId && up2.referrerId !== up1.referrerId) {
        receivers.set(up2.referrerId, 2);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.referralReward.deleteMany({ where: { orderId } });
      for (const [userId, lvl] of receivers) {
        const { bonus } = this.computeLineBonus(
          catalog,
          cfg.minimumOrderSiteTotalRub,
          lvl,
          cfg.level1Percent,
          cfg.level2Percent,
        );
        if (bonus.lessThanOrEqualTo(0)) continue;
        const partner = await tx.userProfile.findUnique({
          where: { userId },
          select: { winWinPartnerApproved: true },
        });
        if (!partner?.winWinPartnerApproved) continue;
        await tx.referralReward.create({
          data: {
            userId,
            orderId,
            level: lvl,
            amount: bonus,
            status: 'PENDING',
          },
        });
      }
    });
  }

  async recalculateRewardsForAllCompletedOrders(): Promise<void> {
    const ids = await this.prisma.order.findMany({
      where: { status: OrderStatus.COMPLETED },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    LOG.log(`referral rewards recalc: ${ids.length} completed orders`);
    for (const { id } of ids) {
      try {
        await this.ensureRewardsForCompletedOrder(id);
      } catch (e) {
        LOG.warn(`recalc reward failed order=${id} ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async getMyReferrals(userId: string) {
    return this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { id: true, email: true, phone: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyRewards(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.referralReward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralReward.count({ where: { userId } }),
    ]);
    return { items, total, page, limit };
  }

  async getReportForExport(userId: string) {
    const referrals = await this.getMyReferrals(userId);
    const rewards = await this.prisma.referralReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { referrals, rewards };
  }

  async requestPartnerPayout(userId: string): Promise<{ ok: true }> {
    const s = await this.getPartnerProgramSummary(userId);
    const payable = Number(s.totals.payableFromCompletedRub);
    if (!Number.isFinite(payable) || payable <= 0) {
      throw new BadRequestException(
        'Запрос выплаты возможен только при начислениях по заказам в статусе «Завершён»; текущих сумм по завершённым нет.',
      );
    }
    return { ok: true as const };
  }
}
