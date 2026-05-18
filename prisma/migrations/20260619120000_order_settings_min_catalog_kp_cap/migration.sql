-- Мин. сумма каталога для «своего» бонуса дизайнера; лимит скидки по строке КП.
INSERT INTO "ReferralConfig" ("id", "key", "value", "description", "updatedAt")
VALUES (
  'ref_seed_order_designer_min_cat',
  'order_designer_own_minimum_catalog_site_total_rub',
  '0',
  'Минимальная сумма «цена на сайте» по заказу для бонуса дизайнера со своего заказа, ₽',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ReferralConfig" ("id", "key", "value", "description", "updatedAt")
VALUES (
  'ref_seed_kp_max_disc',
  'order_kp_max_line_discount_percent',
  '100',
  'Максимальная скидка по строке коммерческого предложения, %',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
