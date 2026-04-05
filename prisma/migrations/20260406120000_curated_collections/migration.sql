-- CreateEnum
CREATE TYPE "CuratedCollectionKind" AS ENUM ('PRODUCT', 'BRAND');

-- CreateTable
CREATE TABLE "CuratedCollection" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "coverMediaObjectId" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "kind" "CuratedCollectionKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuratedCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratedCollectionProductItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CuratedCollectionProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratedCollectionBrandItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CuratedCollectionBrandItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuratedCollection_slug_key" ON "CuratedCollection"("slug");

CREATE INDEX "CuratedCollectionProductItem_collectionId_idx" ON "CuratedCollectionProductItem"("collectionId");

CREATE UNIQUE INDEX "CuratedCollectionProductItem_collectionId_productId_key" ON "CuratedCollectionProductItem"("collectionId", "productId");

CREATE INDEX "CuratedCollectionBrandItem_collectionId_idx" ON "CuratedCollectionBrandItem"("collectionId");

CREATE UNIQUE INDEX "CuratedCollectionBrandItem_collectionId_brandId_key" ON "CuratedCollectionBrandItem"("collectionId", "brandId");

ALTER TABLE "CuratedCollection" ADD CONSTRAINT "CuratedCollection_coverMediaObjectId_fkey" FOREIGN KEY ("coverMediaObjectId") REFERENCES "MediaObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CuratedCollectionProductItem" ADD CONSTRAINT "CuratedCollectionProductItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CuratedCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CuratedCollectionProductItem" ADD CONSTRAINT "CuratedCollectionProductItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CuratedCollectionBrandItem" ADD CONSTRAINT "CuratedCollectionBrandItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CuratedCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CuratedCollectionBrandItem" ADD CONSTRAINT "CuratedCollectionBrandItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
