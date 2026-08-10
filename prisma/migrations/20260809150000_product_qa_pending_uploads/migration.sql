-- CreateTable
CREATE TABLE "ProductQaPendingUpload" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQaPendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductQaPendingUpload_objectKey_key" ON "ProductQaPendingUpload"("objectKey");

-- CreateIndex
CREATE INDEX "ProductQaPendingUpload_productId_userId_createdAt_idx" ON "ProductQaPendingUpload"("productId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductQaPendingUpload_createdAt_idx" ON "ProductQaPendingUpload"("createdAt");

-- AddForeignKey
ALTER TABLE "ProductQaPendingUpload" ADD CONSTRAINT "ProductQaPendingUpload_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaPendingUpload" ADD CONSTRAINT "ProductQaPendingUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
