-- AlterTable
ALTER TABLE "CuratedProductSet" ADD COLUMN "brandId" TEXT;

-- CreateIndex
CREATE INDEX "CuratedProductSet_brandId_idx" ON "CuratedProductSet"("brandId");

-- AddForeignKey
ALTER TABLE "CuratedProductSet" ADD CONSTRAINT "CuratedProductSet_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
