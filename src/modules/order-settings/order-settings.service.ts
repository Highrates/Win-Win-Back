import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateOrderSettingsAdminDto } from './dto/order-settings-admin.dto';
import {
  ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
  ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
  ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
  ORDER_PROGRAM_DEFAULTS,
} from './order-program.constants';

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
  constructor(private prisma: PrismaService) {}

  private async readMap(): Promise<Record<string, string>> {
    const keys = [
      ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
      ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
      ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
    ] as const;
    const rows = await this.prisma.referralConfig.findMany({
      where: { key: { in: [...keys] } },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async getResolved(): Promise<ResolvedOrderProgramConfig> {
    const map = await this.readMap();
    const dp = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT] ?? '0';
    const dm = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB] ?? '0';
    const dk = ORDER_PROGRAM_DEFAULTS[ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT] ?? '100';
    return {
      designerOwnCatalogBonusPercent: parsePercent(map[ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT], parsePercent(dp, 0)),
      designerOwnMinimumCatalogSiteTotalRub: parseMinRub(
        map[ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB],
        parseMinRub(dm, 0),
      ),
      kpMaxLineDiscountPercent: parsePercent(
        map[ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT],
        parsePercent(dk, 100),
      ),
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
    const upsert = (key: string, value: string, description: string) =>
      this.prisma.referralConfig.upsert({
        where: { key },
        update: { value, description },
        create: { key, value, description },
      });
    await this.prisma.$transaction([
      upsert(
        ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
        String(dto.designerOwnCatalogBonusPercent),
        'Процент бонуса дизайнера с суммы «цена на сайте» своего заказа (строчки каталога), 0–100',
      ),
      upsert(
        ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
        String(Math.max(0, Math.floor(dto.designerOwnMinimumCatalogSiteTotalRub))),
        'Минимальная сумма «цена на сайте» по заказу для бонуса дизайнера со своего заказа, ₽',
      ),
      upsert(
        ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
        String(dto.kpMaxLineDiscountPercent),
        'Максимальная скидка по строке коммерческого предложения, % (не выше этого значения и не выше 100%)',
      ),
    ]);
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
