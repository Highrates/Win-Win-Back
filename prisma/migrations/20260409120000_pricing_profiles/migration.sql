-- CreateEnum
CREATE TYPE "ProductPriceMode" AS ENUM ('MANUAL', 'FORMULA');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "priceMode" "ProductPriceMode" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Product" ADD COLUMN "costPriceCny" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "PricingProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "containerType" TEXT NOT NULL,
    "cnyRate" DECIMAL(14,6) NOT NULL,
    "usdRate" DECIMAL(14,6) NOT NULL,
    "eurRate" DECIMAL(14,6) NOT NULL,
    "transferCommissionPct" DECIMAL(10,4) NOT NULL,
    "customsAdValoremPct" DECIMAL(10,4) NOT NULL,
    "customsWeightPct" DECIMAL(10,4) NOT NULL,
    "vatPct" DECIMAL(10,4) NOT NULL,
    "markupPct" DECIMAL(10,4) NOT NULL,
    "agentRub" DECIMAL(14,2) NOT NULL,
    "warehousePortUsd" DECIMAL(14,2) NOT NULL,
    "fobUsd" DECIMAL(14,2) NOT NULL,
    "portMskRub" DECIMAL(14,2) NOT NULL,
    "extraLogisticsRub" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingProfileCategory" (
    "profileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PricingProfileCategory_pkey" PRIMARY KEY ("profileId","categoryId")
);

-- CreateIndex
CREATE INDEX "PricingProfileCategory_categoryId_idx" ON "PricingProfileCategory"("categoryId");

-- AddForeignKey
ALTER TABLE "PricingProfileCategory" ADD CONSTRAINT "PricingProfileCategory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PricingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingProfileCategory" ADD CONSTRAINT "PricingProfileCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
