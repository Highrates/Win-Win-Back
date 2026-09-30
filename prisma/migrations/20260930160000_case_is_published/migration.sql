-- AlterTable
ALTER TABLE "Case" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Case_isPublished_createdAt_idx" ON "Case"("isPublished", "createdAt" DESC);
