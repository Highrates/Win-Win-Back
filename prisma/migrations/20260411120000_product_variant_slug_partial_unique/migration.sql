-- Уникальность slug варианта в рамках товара (несколько NULL допускаются в обычном UNIQUE).
DROP INDEX IF EXISTS "ProductVariant_productId_variantSlug_idx";

CREATE UNIQUE INDEX "ProductVariant_productId_variantSlug_key"
ON "ProductVariant"("productId", "variantSlug")
WHERE "variantSlug" IS NOT NULL AND btrim("variantSlug") <> '';
