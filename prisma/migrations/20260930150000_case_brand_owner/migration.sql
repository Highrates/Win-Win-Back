-- AlterTable
ALTER TABLE "Case" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "brandId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Case_brandId_createdAt_idx" ON "Case"("brandId", "createdAt" DESC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Case" ADD CONSTRAINT "Case_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
