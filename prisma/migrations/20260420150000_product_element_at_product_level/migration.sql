-- Переезд ProductElement с уровня модификации на уровень товара.
-- Элементы становятся общим пулом товара; варианты по-прежнему цепляют
-- (productElementId, brandMaterialColorId) + одну модификацию.

-- 1) Сбрасываем selection варианта и сами элементы (данные только в admin-стадии).
TRUNCATE TABLE "ProductVariantElementSelection" CASCADE;
TRUNCATE TABLE "ProductElementMaterialColor" CASCADE;
TRUNCATE TABLE "ProductElement" CASCADE;

-- 2) Перестраиваем FK/колонки.
ALTER TABLE "ProductElement" DROP CONSTRAINT "ProductElement_modificationId_fkey";
DROP INDEX IF EXISTS "ProductElement_modificationId_idx";
ALTER TABLE "ProductElement" DROP COLUMN "modificationId";
ALTER TABLE "ProductElement" ADD COLUMN "productId" TEXT NOT NULL;
CREATE INDEX "ProductElement_productId_idx" ON "ProductElement"("productId");
ALTER TABLE "ProductElement"
  ADD CONSTRAINT "ProductElement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
