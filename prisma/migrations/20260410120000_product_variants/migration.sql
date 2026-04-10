-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "optionAttributes" JSONB,
    "specsJson" JSONB,
    "sku" TEXT,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "volumeLiters" DECIMAL(12,4),
    "weightKg" DECIMAL(12,4),
    "netLengthMm" INTEGER,
    "netWidthMm" INTEGER,
    "netHeightMm" INTEGER,
    "netVolumeLiters" DECIMAL(12,4),
    "netWeightKg" DECIMAL(12,4),
    "priceMode" "ProductPriceMode" NOT NULL DEFAULT 'MANUAL',
    "costPriceCny" DECIMAL(14,4),
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ProductVariantImage" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductVariantImage_variantId_idx" ON "ProductVariantImage"("variantId");

ALTER TABLE "ProductVariantImage" ADD CONSTRAINT "ProductVariantImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Один вариант на каждый существующий товар (дефолтный)
INSERT INTO "ProductVariant" (
    "id",
    "productId",
    "sortOrder",
    "isDefault",
    "isActive",
    "specsJson",
    "sku",
    "lengthMm",
    "widthMm",
    "heightMm",
    "volumeLiters",
    "weightKg",
    "netLengthMm",
    "netWidthMm",
    "netHeightMm",
    "netVolumeLiters",
    "netWeightKg",
    "priceMode",
    "costPriceCny",
    "price",
    "currency",
    "createdAt",
    "updatedAt"
)
SELECT
    'clpv' || substr(md5(p."id" || 'pv1'), 1, 22),
    p."id",
    0,
    true,
    true,
    p."specsJson",
    p."sku",
    p."lengthMm",
    p."widthMm",
    p."heightMm",
    p."volumeLiters",
    p."weightKg",
    p."netLengthMm",
    p."netWidthMm",
    p."netHeightMm",
    p."netVolumeLiters",
    p."netWeightKg",
    p."priceMode",
    p."costPriceCny",
    p."price",
    p."currency",
    p."createdAt",
    p."updatedAt"
FROM "Product" p;

DROP INDEX IF EXISTS "Product_sku_key";

-- OrderItem: связь с вариантом (исторические строки без варианта допускаются NULL до бэкапа)
ALTER TABLE "OrderItem" ADD COLUMN "productVariantId" TEXT;

UPDATE "OrderItem" oi
SET "productVariantId" = v."id"
FROM "ProductVariant" v
WHERE v."productId" = oi."productId" AND v."isDefault" = true;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CartItem: уникальность по варианту
ALTER TABLE "CartItem" ADD COLUMN "productVariantId" TEXT;

UPDATE "CartItem" ci
SET "productVariantId" = v."id"
FROM "ProductVariant" v
WHERE v."productId" = ci."productId" AND v."isDefault" = true;

DROP INDEX IF EXISTS "CartItem_cartId_productId_key";

ALTER TABLE "CartItem" ALTER COLUMN "productVariantId" SET NOT NULL;

CREATE UNIQUE INDEX "CartItem_cartId_productVariantId_key" ON "CartItem"("cartId", "productVariantId");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Убраны поля, перенесённые на вариант
ALTER TABLE "Product" DROP COLUMN "specsJson";
ALTER TABLE "Product" DROP COLUMN "sku";
ALTER TABLE "Product" DROP COLUMN "lengthMm";
ALTER TABLE "Product" DROP COLUMN "widthMm";
ALTER TABLE "Product" DROP COLUMN "heightMm";
ALTER TABLE "Product" DROP COLUMN "volumeLiters";
ALTER TABLE "Product" DROP COLUMN "weightKg";
ALTER TABLE "Product" DROP COLUMN "netLengthMm";
ALTER TABLE "Product" DROP COLUMN "netWidthMm";
ALTER TABLE "Product" DROP COLUMN "netHeightMm";
ALTER TABLE "Product" DROP COLUMN "netVolumeLiters";
ALTER TABLE "Product" DROP COLUMN "netWeightKg";
ALTER TABLE "Product" DROP COLUMN "priceMode";
ALTER TABLE "Product" DROP COLUMN "costPriceCny";
ALTER TABLE "Product" DROP COLUMN "price";
ALTER TABLE "Product" DROP COLUMN "currency";
