import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
  ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
  ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
} from '../order-settings/order-program.constants';
import {
  REFERRAL_CFG_LEVEL1_PERCENT,
  REFERRAL_CFG_LEVEL2_PERCENT,
  REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB,
} from '../referrals/referral-program.constants';

const REFERRAL_PROGRAM_KEY_DESCRIPTIONS: Record<string, string> = {
  [REFERRAL_CFG_LEVEL1_PERCENT]:
    'Процент партнёра с суммы «цена на сайте» (позиции заказа), уровень L1',
  [REFERRAL_CFG_LEVEL2_PERCENT]:
    'Процент партнёра с суммы «цена на сайте» (позиции заказа), уровень L2',
  [REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB]:
    'Минимальная сумма «цена на сайте» заказа для начисления, ₽',
};

const DESIGNER_BONUS_KEY_DESCRIPTIONS: Record<string, string> = {
  [ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT]:
    'Процент бонуса дизайнера с суммы «цена на сайте» своего заказа (строчки позиций каталога), 0–100',
  [ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB]:
    'Минимальная сумма «цена на сайте» по заказу для бонуса дизайнера со своего заказа, ₽',
};

const KP_MAX_LINE_DISCOUNT_DESCRIPTION =
  'Максимальная скидка по строке коммерческого предложения, % (не выше этого значения и не выше 100%)';

/** Зеркалирование основных профилей в ReferralConfig (обратная совместимость, KP — единственный «чистый» ключ). */
@Injectable()
export class ProgramConfigSyncService {
  constructor(private readonly prisma: PrismaService) {}

  private upsertKey(key: string, value: string, description: string) {
    return this.prisma.referralConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description },
    });
  }

  async mirrorReferralProgram(values: {
    level1Percent: number;
    level2Percent: number;
    minimumOrderSiteTotalRub: number;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.upsertKey(
        REFERRAL_CFG_LEVEL1_PERCENT,
        String(values.level1Percent),
        REFERRAL_PROGRAM_KEY_DESCRIPTIONS[REFERRAL_CFG_LEVEL1_PERCENT],
      ),
      this.upsertKey(
        REFERRAL_CFG_LEVEL2_PERCENT,
        String(values.level2Percent),
        REFERRAL_PROGRAM_KEY_DESCRIPTIONS[REFERRAL_CFG_LEVEL2_PERCENT],
      ),
      this.upsertKey(
        REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB,
        String(values.minimumOrderSiteTotalRub),
        REFERRAL_PROGRAM_KEY_DESCRIPTIONS[REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB],
      ),
    ]);
  }

  async mirrorDesignerBonus(values: {
    designerOwnCatalogBonusPercent: number;
    designerOwnMinimumCatalogSiteTotalRub: number;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.upsertKey(
        ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT,
        String(values.designerOwnCatalogBonusPercent),
        DESIGNER_BONUS_KEY_DESCRIPTIONS[ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT],
      ),
      this.upsertKey(
        ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB,
        String(values.designerOwnMinimumCatalogSiteTotalRub),
        DESIGNER_BONUS_KEY_DESCRIPTIONS[ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB],
      ),
    ]);
  }

  async mirrorKpMaxLineDiscountPercent(kpMaxLineDiscountPercent: number): Promise<void> {
    await this.upsertKey(
      ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT,
      String(kpMaxLineDiscountPercent),
      KP_MAX_LINE_DISCOUNT_DESCRIPTION,
    );
  }
}
