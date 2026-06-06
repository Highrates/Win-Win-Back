-- L1/L2 и мин. сумма — в профиле реферальной программы (не глобально в ReferralConfig)
ALTER TABLE "ReferralProgramProfile" ADD COLUMN "level1Percent" DECIMAL(10,4) NOT NULL DEFAULT 5;
ALTER TABLE "ReferralProgramProfile" ADD COLUMN "level2Percent" DECIMAL(10,4) NOT NULL DEFAULT 3;
ALTER TABLE "ReferralProgramProfile" ADD COLUMN "minimumOrderSiteTotalRub" INTEGER NOT NULL DEFAULT 0;

UPDATE "ReferralProgramProfile"
SET
  "level1Percent" = COALESCE(
    (
      SELECT NULLIF(TRIM("value"), '')::DECIMAL
      FROM "ReferralConfig"
      WHERE "key" = 'referral_level1_percent'
      LIMIT 1
    ),
    5
  ),
  "level2Percent" = COALESCE(
    (
      SELECT NULLIF(TRIM("value"), '')::DECIMAL
      FROM "ReferralConfig"
      WHERE "key" = 'referral_level2_percent'
      LIMIT 1
    ),
    3
  ),
  "minimumOrderSiteTotalRub" = COALESCE(
    (
      SELECT NULLIF(TRIM("value"), '')::INTEGER
      FROM "ReferralConfig"
      WHERE "key" = 'referral_minimum_order_site_total_rub'
      LIMIT 1
    ),
    0
  );
