/** Ключи ReferralConfig для публичной реферальной программы Win-Win */
export const REFERRAL_CFG_LEVEL1_PERCENT = 'referral_level1_percent';
export const REFERRAL_CFG_LEVEL2_PERCENT = 'referral_level2_percent';
export const REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB = 'referral_minimum_order_site_total_rub';

export const REFERRAL_PROGRAM_DEFAULTS: Record<string, string> = {
  [REFERRAL_CFG_LEVEL1_PERCENT]: '5',
  [REFERRAL_CFG_LEVEL2_PERCENT]: '3',
  [REFERRAL_CFG_MIN_ORDER_SITE_TOTAL_RUB]: '0',
};
