-- CreateEnum
CREATE TYPE "CuratedHomeGridSize" AS ENUM ('FOUR', 'EIGHT', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "CuratedHomeOrderMode" AS ENUM ('FIXED', 'RANDOM');

-- AlterTable
ALTER TABLE "CuratedCollection" ADD COLUMN "showOnHome" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CuratedCollection" ADD COLUMN "homeOrder" INTEGER;
ALTER TABLE "CuratedCollection" ADD COLUMN "homeGridSize" "CuratedHomeGridSize" NOT NULL DEFAULT 'FOUR';
ALTER TABLE "CuratedCollection" ADD COLUMN "homeOrderMode" "CuratedHomeOrderMode" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "CuratedCollection" ADD COLUMN "homePriceMin" INTEGER;
ALTER TABLE "CuratedCollection" ADD COLUMN "homePriceMax" INTEGER;

-- CreateIndex
CREATE INDEX "CuratedCollection_showOnHome_homeOrder_idx" ON "CuratedCollection"("showOnHome", "homeOrder");

-- Preserve previous hardcoded home rails if those collections exist.
UPDATE "CuratedCollection"
SET
  "showOnHome" = true,
  "homeOrder" = 1,
  "homeGridSize" = 'FOUR',
  "homeOrderMode" = 'FIXED'
WHERE "slug" = 'kollektsiya-1' AND "kind" = 'PRODUCT';

UPDATE "CuratedCollection"
SET
  "showOnHome" = true,
  "homeOrder" = 3,
  "homeGridSize" = 'UNLIMITED',
  "homeOrderMode" = 'FIXED'
WHERE "slug" = 'rekomendatsii' AND "kind" = 'PRODUCT';
