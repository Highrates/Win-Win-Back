-- AlterTable: габариты нетто у товара
ALTER TABLE "Product" ADD COLUMN "netLengthMm" INTEGER,
ADD COLUMN "netWidthMm" INTEGER,
ADD COLUMN "netHeightMm" INTEGER,
ADD COLUMN "netVolumeLiters" DECIMAL(12,4),
ADD COLUMN "netWeightKg" DECIMAL(12,4);
