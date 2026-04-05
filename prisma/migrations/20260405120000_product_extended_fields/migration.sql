-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "shortDescription" VARCHAR(280),
ADD COLUMN "additionalInfoHtml" TEXT,
ADD COLUMN "specsJson" JSONB,
ADD COLUMN "sku" TEXT,
ADD COLUMN "deliveryText" TEXT,
ADD COLUMN "technicalSpecs" TEXT,
ADD COLUMN "lengthMm" INTEGER,
ADD COLUMN "widthMm" INTEGER,
ADD COLUMN "heightMm" INTEGER,
ADD COLUMN "volumeLiters" DECIMAL(12,4),
ADD COLUMN "weightKg" DECIMAL(12,4),
ADD COLUMN "seoTitle" TEXT,
ADD COLUMN "seoDescription" TEXT;

-- Если в volumeLiters когда-либо писали «литры» (мм³/10⁶), для м³ (мм³/10⁹) делим на 1000. На свежей БД все NULL — шаг без эффекта.
UPDATE "Product" SET "volumeLiters" = "volumeLiters" / 1000 WHERE "volumeLiters" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
