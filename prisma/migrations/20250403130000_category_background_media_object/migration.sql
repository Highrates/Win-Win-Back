-- Связь фона категории с медиатекой (objects/…)
ALTER TABLE "Category" ADD COLUMN "backgroundMediaObjectId" TEXT;

ALTER TABLE "Category" ADD CONSTRAINT "Category_backgroundMediaObjectId_fkey"
  FOREIGN KEY ("backgroundMediaObjectId") REFERENCES "MediaObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Category_backgroundMediaObjectId_idx" ON "Category"("backgroundMediaObjectId");
