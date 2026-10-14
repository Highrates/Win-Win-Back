-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerArchivedAt" TIMESTAMP(3);
