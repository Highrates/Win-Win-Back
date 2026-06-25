-- CreateEnum
CREATE TYPE "SourcingRequestStatus" AS ENUM ('PENDING_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SourcingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deliveryCity" TEXT,
    "status" "SourcingRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "productLink" TEXT,
    "material" TEXT,
    "color" TEXT,
    "size" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "expectedBudget" DECIMAL(12,2),

    CONSTRAINT "SourcingRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRequestItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SourcingRequestItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRequestAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SourcingRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingRequest_userId_status_idx" ON "SourcingRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "SourcingRequest_status_createdAt_idx" ON "SourcingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SourcingRequestItem_requestId_idx" ON "SourcingRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "SourcingRequestItemImage_itemId_idx" ON "SourcingRequestItemImage"("itemId");

-- CreateIndex
CREATE INDEX "SourcingRequestAttachment_requestId_idx" ON "SourcingRequestAttachment"("requestId");

-- AddForeignKey
ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRequestItem" ADD CONSTRAINT "SourcingRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRequestItemImage" ADD CONSTRAINT "SourcingRequestItemImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SourcingRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingRequestAttachment" ADD CONSTRAINT "SourcingRequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
