-- CreateEnum
CREATE TYPE "ProductQaAuthorRole" AS ENUM ('USER', 'STAFF');

-- CreateEnum
CREATE TYPE "ProductQaMessageStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateTable
CREATE TABLE "ProductQaThread" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "messageCountPublic" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductQaThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQaMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "ProductQaAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "productVariantId" TEXT,
    "status" "ProductQaMessageStatus" NOT NULL DEFAULT 'VISIBLE',
    "hiddenByUserId" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductQaThread_productId_key" ON "ProductQaThread"("productId");

-- CreateIndex
CREATE INDEX "ProductQaMessage_threadId_createdAt_idx" ON "ProductQaMessage"("threadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProductQaMessage_threadId_status_createdAt_idx" ON "ProductQaMessage"("threadId", "status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ProductQaThread" ADD CONSTRAINT "ProductQaThread_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ProductQaThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_hiddenByUserId_fkey" FOREIGN KEY ("hiddenByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
