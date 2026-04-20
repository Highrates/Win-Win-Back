-- Переделка модели вариантов: Модификация (размер) → Элементы → Варианты с selection «материал-цвет».
-- Старые данные размеров/материалов/цветов/вариантов удаляются (пользовательское решение).

-- 1) Удаляем данные вариантов (каскадно чистит Favorite/CartItem; OrderItem.productVariantId = NULL по схеме).
TRUNCATE TABLE "ProductVariant" CASCADE;

-- 2) Сбрасываем FK-колонки варианта.
ALTER TABLE "ProductVariant"
  DROP COLUMN IF EXISTS "sizeOptionId",
  DROP COLUMN IF EXISTS "materialOptionId",
  DROP COLUMN IF EXISTS "colorOptionId",
  DROP COLUMN IF EXISTS "optionAttributes",
  DROP COLUMN IF EXISTS "specsJson";

-- 3) Удаляем устаревшие таблицы (FK с ProductVariant уже сброшены шагом 2).
DROP TABLE IF EXISTS "ProductVariantImage";
DROP TABLE IF EXISTS "ProductColorMaterial";
DROP TABLE IF EXISTS "ProductColorOption";
DROP TABLE IF EXISTS "ProductMaterialOption";
DROP TABLE IF EXISTS "ProductSizeOption";

-- 4) BrandMaterial
CREATE TABLE "BrandMaterial" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandMaterial_brandId_idx" ON "BrandMaterial" ("brandId");
ALTER TABLE "BrandMaterial"
  ADD CONSTRAINT "BrandMaterial_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) BrandMaterialColor
CREATE TABLE "BrandMaterialColor" (
  "id" TEXT NOT NULL,
  "brandMaterialId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandMaterialColor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandMaterialColor_brandMaterialId_idx" ON "BrandMaterialColor" ("brandMaterialId");
ALTER TABLE "BrandMaterialColor"
  ADD CONSTRAINT "BrandMaterialColor_brandMaterialId_fkey"
  FOREIGN KEY ("brandMaterialId") REFERENCES "BrandMaterial" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 6) ProductModification
CREATE TABLE "ProductModification" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "modificationSlug" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductModification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductModification_productId_idx" ON "ProductModification" ("productId");
ALTER TABLE "ProductModification"
  ADD CONSTRAINT "ProductModification_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 7) ProductElement
CREATE TABLE "ProductElement" (
  "id" TEXT NOT NULL,
  "modificationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductElement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductElement_modificationId_idx" ON "ProductElement" ("modificationId");
ALTER TABLE "ProductElement"
  ADD CONSTRAINT "ProductElement_modificationId_fkey"
  FOREIGN KEY ("modificationId") REFERENCES "ProductModification" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) ProductElementMaterialColor (пул «материал-цвет» для элемента)
CREATE TABLE "ProductElementMaterialColor" (
  "productElementId" TEXT NOT NULL,
  "brandMaterialColorId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductElementMaterialColor_pkey" PRIMARY KEY ("productElementId","brandMaterialColorId")
);
CREATE INDEX "ProductElementMaterialColor_brandMaterialColorId_idx"
  ON "ProductElementMaterialColor" ("brandMaterialColorId");
ALTER TABLE "ProductElementMaterialColor"
  ADD CONSTRAINT "ProductElementMaterialColor_productElementId_fkey"
  FOREIGN KEY ("productElementId") REFERENCES "ProductElement" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductElementMaterialColor"
  ADD CONSTRAINT "ProductElementMaterialColor_brandMaterialColorId_fkey"
  FOREIGN KEY ("brandMaterialColorId") REFERENCES "BrandMaterialColor" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 9) ProductVariantElementSelection (выбор «материал-цвет» в варианте)
CREATE TABLE "ProductVariantElementSelection" (
  "variantId" TEXT NOT NULL,
  "productElementId" TEXT NOT NULL,
  "brandMaterialColorId" TEXT NOT NULL,
  CONSTRAINT "ProductVariantElementSelection_pkey" PRIMARY KEY ("variantId","productElementId")
);
CREATE INDEX "ProductVariantElementSelection_productElementId_idx"
  ON "ProductVariantElementSelection" ("productElementId");
CREATE INDEX "ProductVariantElementSelection_brandMaterialColorId_idx"
  ON "ProductVariantElementSelection" ("brandMaterialColorId");
ALTER TABLE "ProductVariantElementSelection"
  ADD CONSTRAINT "ProductVariantElementSelection_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantElementSelection"
  ADD CONSTRAINT "ProductVariantElementSelection_productElementId_fkey"
  FOREIGN KEY ("productElementId") REFERENCES "ProductElement" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantElementSelection"
  ADD CONSTRAINT "ProductVariantElementSelection_brandMaterialColorId_fkey"
  FOREIGN KEY ("brandMaterialColorId") REFERENCES "BrandMaterialColor" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10) ProductVariant.modificationId (NOT NULL) + уникальность (productId, variantSlug)
ALTER TABLE "ProductVariant"
  ADD COLUMN "modificationId" TEXT NOT NULL;
CREATE INDEX "ProductVariant_modificationId_idx" ON "ProductVariant" ("modificationId");
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_modificationId_fkey"
  FOREIGN KEY ("modificationId") REFERENCES "ProductModification" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "ProductVariant_productId_variantSlug_key";
CREATE UNIQUE INDEX "ProductVariant_productId_variantSlug_key"
  ON "ProductVariant" ("productId", "variantSlug");
