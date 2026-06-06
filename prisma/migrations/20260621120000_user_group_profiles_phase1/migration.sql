-- CreateTable
CREATE TABLE "ReferralProgramProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgramProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerBonusProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "designerOwnCatalogBonusPercent" DECIMAL(10,4) NOT NULL,
    "designerOwnMinimumCatalogSiteTotalRub" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerBonusProfile_pkey" PRIMARY KEY ("id")
);

-- One default profile per type
CREATE UNIQUE INDEX "ReferralProgramProfile_single_default_idx"
  ON "ReferralProgramProfile" ("isDefault")
  WHERE "isDefault" = true;

CREATE UNIQUE INDEX "DesignerBonusProfile_single_default_idx"
  ON "DesignerBonusProfile" ("isDefault")
  WHERE "isDefault" = true;

-- Seed default referral program profile
INSERT INTO "ReferralProgramProfile" (
    "id", "name", "sortOrder", "isDefault", "enabled", "updatedAt"
) VALUES (
    'ref_prog_profile_default',
    'По умолчанию',
    0,
    true,
    true,
    NOW()
);

-- Seed default designer bonus profile from ReferralConfig (fallback 0)
INSERT INTO "DesignerBonusProfile" (
    "id",
    "name",
    "sortOrder",
    "isDefault",
    "designerOwnCatalogBonusPercent",
    "designerOwnMinimumCatalogSiteTotalRub",
    "updatedAt"
) VALUES (
    'designer_bonus_profile_default',
    'По умолчанию',
    0,
    true,
    COALESCE(
        (
            SELECT NULLIF(TRIM("value"), '')::DECIMAL
            FROM "ReferralConfig"
            WHERE "key" = 'order_designer_own_catalog_bonus_percent'
            LIMIT 1
        ),
        0
    ),
    COALESCE(
        (
            SELECT NULLIF(TRIM("value"), '')::INTEGER
            FROM "ReferralConfig"
            WHERE "key" = 'order_designer_own_minimum_catalog_site_total_rub'
            LIMIT 1
        ),
        0
    ),
    NOW()
);
