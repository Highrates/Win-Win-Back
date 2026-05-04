-- Удаление устаревшего избранного по варианту SKU (GET/POST /favorites).
-- Избранное в продукте: ProductLike + GET /likes/collection.

DROP TABLE IF EXISTS "Favorite";

-- Счётчики лайков: не допускаем отрицательных значений (рассинхрон / баги).
UPDATE "Product" SET "likesUserCount" = 0 WHERE "likesUserCount" < 0;
UPDATE "Case" SET "likesUserCount" = 0 WHERE "likesUserCount" < 0;

ALTER TABLE "Product" ADD CONSTRAINT "Product_likesUserCount_nonneg" CHECK ("likesUserCount" >= 0);
ALTER TABLE "Case" ADD CONSTRAINT "Case_likesUserCount_nonneg" CHECK ("likesUserCount" >= 0);
