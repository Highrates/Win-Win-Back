-- AlterTable
ALTER TABLE "CatalogTag" ADD COLUMN "coverImageUrl" TEXT,
ADD COLUMN "coverMediaObjectId" TEXT;

-- AddForeignKey
ALTER TABLE "CatalogTag" ADD CONSTRAINT "CatalogTag_coverMediaObjectId_fkey" FOREIGN KEY ("coverMediaObjectId") REFERENCES "MediaObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
