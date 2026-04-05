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

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
