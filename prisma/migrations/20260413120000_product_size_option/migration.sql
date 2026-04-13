-- CreateTable
CREATE TABLE "ProductSizeOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeSlug" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSizeOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductSizeOption_productId_idx" ON "ProductSizeOption"("productId");

ALTER TABLE "ProductSizeOption" ADD CONSTRAINT "ProductSizeOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- По одному размеру «Стандарт» на каждый товар (данные материалов и вариантов привяжем к нему)
INSERT INTO "ProductSizeOption" ("id", "productId", "name", "sizeSlug", "sortOrder")
SELECT gen_random_uuid()::text, p."id", 'Стандарт', NULL, 0
FROM "Product" p;

-- Новые колонки до удаления productId
ALTER TABLE "ProductMaterialOption" ADD COLUMN "sizeOptionId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "sizeOptionId" TEXT;

UPDATE "ProductMaterialOption" AS mo
SET "sizeOptionId" = so."id"
FROM "ProductSizeOption" AS so
WHERE so."productId" = mo."productId";

UPDATE "ProductVariant" AS v
SET "sizeOptionId" = so."id"
FROM "ProductSizeOption" AS so
WHERE so."productId" = v."productId";

ALTER TABLE "ProductMaterialOption" DROP CONSTRAINT "ProductMaterialOption_productId_fkey";

ALTER TABLE "ProductMaterialOption" DROP COLUMN "productId";

ALTER TABLE "ProductMaterialOption" ALTER COLUMN "sizeOptionId" SET NOT NULL;

ALTER TABLE "ProductVariant" ALTER COLUMN "sizeOptionId" SET NOT NULL;

ALTER TABLE "ProductMaterialOption" ADD CONSTRAINT "ProductMaterialOption_sizeOptionId_fkey" FOREIGN KEY ("sizeOptionId") REFERENCES "ProductSizeOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_sizeOptionId_fkey" FOREIGN KEY ("sizeOptionId") REFERENCES "ProductSizeOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
