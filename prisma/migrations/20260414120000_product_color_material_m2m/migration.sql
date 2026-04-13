-- Цвет привязан к размеру; связь с материалами — M2M через ProductColorMaterial.

CREATE TABLE "ProductColorMaterial" (
    "colorOptionId" TEXT NOT NULL,
    "materialOptionId" TEXT NOT NULL,
    CONSTRAINT "ProductColorMaterial_pkey" PRIMARY KEY ("colorOptionId","materialOptionId")
);

ALTER TABLE "ProductColorOption" ADD COLUMN "sizeOptionId" TEXT;

UPDATE "ProductColorOption" AS c
SET "sizeOptionId" = m."sizeOptionId"
FROM "ProductMaterialOption" AS m
WHERE m."id" = c."materialOptionId";

INSERT INTO "ProductColorMaterial" ("colorOptionId", "materialOptionId")
SELECT "id", "materialOptionId" FROM "ProductColorOption";

ALTER TABLE "ProductColorOption" DROP CONSTRAINT "ProductColorOption_materialOptionId_fkey";

ALTER TABLE "ProductColorOption" DROP COLUMN "materialOptionId";

ALTER TABLE "ProductColorOption" ALTER COLUMN "sizeOptionId" SET NOT NULL;

CREATE INDEX "ProductColorOption_sizeOptionId_idx" ON "ProductColorOption"("sizeOptionId");

CREATE INDEX "ProductColorMaterial_materialOptionId_idx" ON "ProductColorMaterial"("materialOptionId");

ALTER TABLE "ProductColorMaterial" ADD CONSTRAINT "ProductColorMaterial_colorOptionId_fkey" FOREIGN KEY ("colorOptionId") REFERENCES "ProductColorOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductColorMaterial" ADD CONSTRAINT "ProductColorMaterial_materialOptionId_fkey" FOREIGN KEY ("materialOptionId") REFERENCES "ProductMaterialOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductColorOption" ADD CONSTRAINT "ProductColorOption_sizeOptionId_fkey" FOREIGN KEY ("sizeOptionId") REFERENCES "ProductSizeOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
