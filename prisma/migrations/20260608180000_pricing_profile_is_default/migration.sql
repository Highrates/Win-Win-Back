-- Профили ценообразования: множество профилей с пересекающимися категориями;
-- ровно один «Основной» (isDefault) для пользователей без группы.

ALTER TABLE "PricingProfile" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "PricingProfile_single_default_idx"
  ON "PricingProfile" ("isDefault")
  WHERE "isDefault" = true;

-- Самый ранний профиль становится основным (если профили уже есть).
UPDATE "PricingProfile"
SET "isDefault" = true
WHERE "id" = (
  SELECT "id" FROM "PricingProfile"
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1
);
