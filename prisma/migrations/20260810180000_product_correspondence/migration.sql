-- CreateTable
CREATE TABLE "ProductCorrespondence" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCorrespondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCorrespondenceMessage" (
    "id" TEXT NOT NULL,
    "correspondenceId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "ProductQaAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "productVariantId" TEXT,
    "publishedQaMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCorrespondenceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCorrespondenceAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "ProductQaAttachmentKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCorrespondenceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCorrespondence_productId_customerUserId_key" ON "ProductCorrespondence"("productId", "customerUserId");

-- CreateIndex
CREATE INDEX "ProductCorrespondence_customerUserId_lastMessageAt_idx" ON "ProductCorrespondence"("customerUserId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "ProductCorrespondence_productId_lastMessageAt_idx" ON "ProductCorrespondence"("productId", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCorrespondenceMessage_publishedQaMessageId_key" ON "ProductCorrespondenceMessage"("publishedQaMessageId");

-- CreateIndex
CREATE INDEX "ProductCorrespondenceMessage_correspondenceId_createdAt_idx" ON "ProductCorrespondenceMessage"("correspondenceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProductCorrespondenceAttachment_messageId_sortOrder_idx" ON "ProductCorrespondenceAttachment"("messageId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductCorrespondence" ADD CONSTRAINT "ProductCorrespondence_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondence" ADD CONSTRAINT "ProductCorrespondence_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondenceMessage" ADD CONSTRAINT "ProductCorrespondenceMessage_correspondenceId_fkey" FOREIGN KEY ("correspondenceId") REFERENCES "ProductCorrespondence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondenceMessage" ADD CONSTRAINT "ProductCorrespondenceMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondenceMessage" ADD CONSTRAINT "ProductCorrespondenceMessage_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondenceMessage" ADD CONSTRAINT "ProductCorrespondenceMessage_publishedQaMessageId_fkey" FOREIGN KEY ("publishedQaMessageId") REFERENCES "ProductQaMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCorrespondenceAttachment" ADD CONSTRAINT "ProductCorrespondenceAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProductCorrespondenceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
