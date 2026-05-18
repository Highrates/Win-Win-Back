/** Процент бонуса дизайнера с суммы «цена на сайте» по своим заказам (покупатель = он сам). */
export const ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT = 'order_designer_own_catalog_bonus_percent';
/** Минимальная сумма «цена на сайте» по заказу, ниже которой не начисляется бонус дизайнера со своего заказа */
export const ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB = 'order_designer_own_minimum_catalog_site_total_rub';
/** Максимальная скидка по строке КП, % (0–100); 100 = без доп. ограничения ниже общего потолка 100% */
export const ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT = 'order_kp_max_line_discount_percent';

export const ORDER_PROGRAM_DEFAULTS: Record<string, string> = {
  [ORDER_CFG_DESIGNER_OWN_CATALOG_BONUS_PERCENT]: '0',
  [ORDER_CFG_DESIGNER_OWN_MIN_CATALOG_SITE_TOTAL_RUB]: '0',
  [ORDER_CFG_KP_MAX_LINE_DISCOUNT_PERCENT]: '100',
};
