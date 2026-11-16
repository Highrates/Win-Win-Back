-- Освободить слоты у скрытых коллекций (раньше держали homeOrder при showOnHome).
UPDATE "CuratedCollection"
SET
  "showOnHome" = false,
  "homeOrder" = NULL,
  "homePriceMin" = NULL,
  "homePriceMax" = NULL,
  "homeOrderMode" = 'FIXED'
WHERE "showOnHome" = true AND "isActive" = false;

-- Partial unique: один homeOrder среди активных коллекций на главной.
CREATE UNIQUE INDEX "CuratedCollection_homeOrder_active_home_key"
ON "CuratedCollection"("homeOrder")
WHERE "showOnHome" = true AND "isActive" = true AND "homeOrder" IS NOT NULL;
