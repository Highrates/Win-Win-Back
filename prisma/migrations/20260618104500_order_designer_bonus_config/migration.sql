-- Процент бонуса дизайнера с суммы каталога по своим заказам (настройки «Заказы» в админке).
INSERT INTO "ReferralConfig" ("id", "key", "value", "description", "updatedAt")
VALUES (
  'ref_seed_order_designer_own_pct',
  'order_designer_own_catalog_bonus_percent',
  '0',
  'Процент бонуса дизайнера с суммы «цена на сайте» своего заказа (строчки позиций каталога), 0–100',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
