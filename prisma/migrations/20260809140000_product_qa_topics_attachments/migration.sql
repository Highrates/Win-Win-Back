-- CreateEnum
CREATE TYPE "ProductQaAttachmentKind" AS ENUM ('IMAGE', 'FILE');

-- AlterTable: topics on ProductQaThread
DROP INDEX IF EXISTS "ProductQaThread_productId_key";

ALTER TABLE "ProductQaThread" ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Общие вопросы';
ALTER TABLE "ProductQaThread" ADD COLUMN "slug" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "ProductQaThread" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductQaThread" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ProductQaThread"
SET "title" = 'Общие вопросы',
    "slug" = 'general',
    "isDefault" = true,
    "sortOrder" = 0;

CREATE UNIQUE INDEX "ProductQaThread_productId_slug_key" ON "ProductQaThread"("productId", "slug");
CREATE INDEX "ProductQaThread_productId_sortOrder_idx" ON "ProductQaThread"("productId", "sortOrder");

-- CreateTable
CREATE TABLE "ProductQaAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "ProductQaAttachmentKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQaAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductQaAttachment_messageId_sortOrder_idx" ON "ProductQaAttachment"("messageId", "sortOrder");

ALTER TABLE "ProductQaAttachment" ADD CONSTRAINT "ProductQaAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProductQaMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
