-- Избранное привязано к варианту (SKU), не к товару.

ALTER TABLE "Favorite" ADD COLUMN "productVariantId" TEXT;

UPDATE "Favorite" f
SET "productVariantId" = (
  SELECT v.id
  FROM "ProductVariant" v
  WHERE v."productId" = f."productId"
  ORDER BY v."isDefault" DESC, v."sortOrder" ASC, v.id ASC
  LIMIT 1
);

DELETE FROM "Favorite" WHERE "productVariantId" IS NULL;

ALTER TABLE "Favorite" ALTER COLUMN "productVariantId" SET NOT NULL;

DROP INDEX IF EXISTS "Favorite_userId_productId_key";

ALTER TABLE "Favorite" DROP CONSTRAINT IF EXISTS "Favorite_productId_fkey";

ALTER TABLE "Favorite" DROP COLUMN "productId";

CREATE UNIQUE INDEX "Favorite_userId_productVariantId_key" ON "Favorite"("userId", "productVariantId");

ALTER TABLE "Favorite"
  ADD CONSTRAINT "Favorite_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
