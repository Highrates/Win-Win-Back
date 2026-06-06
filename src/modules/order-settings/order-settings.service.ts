import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramConfigSyncService } from '../user-group-profiles/program-config-sync.service';
import { UserGroupProfileResolverService } from '../user-group-profiles/user-group-profile-resolver.service';
import type { UpdateOrderSettingsAdminDto } from './dto/order-settings-admin.dto';
import {
  ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
  ORDER_PROGRAM_DEFAULTS,
} from './order-program.constants';

function parsePercent(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(100, n);
}

export type ResolvedOrderProgramConfig = {
  designerOwnCatalogBonusPercent: number;
  designerOwnMinimumCatalogSiteTotalRub: number;
  kpMaxLineDiscountPercent: number;
};

export type OrderSettingsAdminPayload = ResolvedOrderProgramConfig & {
  catalogBasisNote: 'ORDER_LINE_SITE_UNIT_PRICE_SUM';
  /** Подсказка для UI: реферальная выплата только по «Завершён», ожидание — по конвейеру. */
  referralPayoutRulesNote: 'PAYOUT_ONLY_COMPLETED_EXPECTED_ALL_NON_DRAFT';
};

@Injectable()
export class OrderSettingsService {
  constructor(
    private prisma: PrismaService,
    private profileResolver: UserGroupProfileResolverService,
    private configSync: ProgramConfigSyncService,
  ) {}

  private async readKpMaxLineDiscountPercent(): Promise<number> {
    const row = await this.prisma.referralConfig.findUnique({
      where: { key: ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT },
    });
    const dk = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT] ?? '100';
    return parsePercent(row?.value, parsePercent(dk, 100));
  }

  async getResolved(userId?: string): Promise<ResolvedOrderProgramConfig> {
    const bonus = await this.profileResolver.resolveDesignerBonusForUser(userId);
    return {
      designerOwnCatalogBonusPercent: bonus.designerOwnCatalogBonusPercent,
      designerOwnMinimumCatalogSiteTotalRub: bonus.designerOwnMinimumCatalogSiteTotalRub,
      kpMaxLineDiscountPercent: await this.readKpMaxLineDiscountPercent(),
    };
  }

  async getAdmin(): Promise<OrderSettingsAdminPayload> {
    const r = await this.getResolved();
    return {
      ...r,
      catalogBasisNote: 'ORDER_LINE_SITE_UNIT_PRICE_SUM',
      referralPayoutRulesNote: 'PAYOUT_ONLY_COMPLETED_EXPECTED_ALL_NON_DRAFT',
    };
  }

  async patchAdmin(dto: UpdateOrderSettingsAdminDto): Promise<OrderSettingsAdminPayload> {
    if (dto.kpMaxLineDiscountPercent === undefined) {
      throw new BadRequestException(
        'Укажите kpMaxLineDiscountPercent. Бонусы дизайнера настраиваются через settings/admin/designer-bonus-profiles.',
      );
    }

    await this.configSync.mirrorKpMaxLineDiscountPercent(dto.kpMaxLineDiscountPercent);

    return this.getAdmin();
  }

  /** Бонус дизайнера со своего заказа: каталог заказа × %, если ≥ порога и % > 0. */
  computeDesignerOwnCatalogBonusRub(cfg: ResolvedOrderProgramConfig, catalogSum: Prisma.Decimal): Prisma.Decimal {
    if (!cfg.designerOwnCatalogBonusPercent || cfg.designerOwnCatalogBonusPercent <= 0) {
      return new Prisma.Decimal(0);
    }
    const minD = new Prisma.Decimal(cfg.designerOwnMinimumCatalogSiteTotalRub);
    if (catalogSum.lt(minD)) return new Prisma.Decimal(0);
    return catalogSum
      .mul(new Prisma.Decimal(cfg.designerOwnCatalogBonusPercent))
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
}
