-- CreateTable
CREATE TABLE "CatalogTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCatalogTag" (
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProductCatalogTag_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTag_slug_key" ON "CatalogTag"("slug");

-- CreateIndex
CREATE INDEX "ProductCatalogTag_tagId_idx" ON "ProductCatalogTag"("tagId");

-- AddForeignKey
ALTER TABLE "ProductCatalogTag" ADD CONSTRAINT "ProductCatalogTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalogTag" ADD CONSTRAINT "ProductCatalogTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CatalogTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
