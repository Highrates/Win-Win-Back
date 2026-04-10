-- Move 3D model / drawing URLs from Product to default ProductVariant

ALTER TABLE "ProductVariant" ADD COLUMN "model3dUrl" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "drawingUrl" TEXT;

UPDATE "ProductVariant" AS v
SET
  "model3dUrl" = p."model3dUrl",
  "drawingUrl" = p."drawingUrl"
FROM "Product" AS p
WHERE v."productId" = p."id" AND v."isDefault" = true;

ALTER TABLE "Product" DROP COLUMN "model3dUrl";
ALTER TABLE "Product" DROP COLUMN "drawingUrl";
