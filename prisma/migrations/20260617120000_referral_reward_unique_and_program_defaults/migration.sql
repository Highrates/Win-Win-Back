-- Уникальность начисления по получателю, заказу и уровню; дефолты настроек программы (фаза 2).
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_userId_orderId_level_key" UNIQUE ("userId", "orderId", "level");

INSERT INTO "ReferralConfig" ("id", "key", "value", "description", "updatedAt")
VALUES
  ('ref_seed_level1_pct', 'referral_level1_percent', '5', 'Процент партнёра с суммы «цена на сайте» (позиции заказа), уровень L1', NOW()),
  ('ref_seed_level2_pct', 'referral_level2_percent', '3', 'Процент партнёра с суммы «цена на сайте» (позиции заказа), уровень L2', NOW()),
  ('ref_seed_min_catalog', 'referral_minimum_order_site_total_rub', '0', 'Минимальная сумма «цена на сайте» заказа для начисления, ₽', NOW())
ON CONFLICT ("key") DO NOTHING;
