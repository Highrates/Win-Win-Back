-- CreateTable
CREATE TABLE "CuratedProductSet" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "coverMediaObjectId" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuratedProductSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratedProductSetItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CuratedProductSetItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuratedProductSet_slug_key" ON "CuratedProductSet"("slug");

CREATE INDEX "CuratedProductSetItem_setId_idx" ON "CuratedProductSetItem"("setId");

CREATE UNIQUE INDEX "CuratedProductSetItem_setId_productId_key" ON "CuratedProductSetItem"("setId", "productId");

ALTER TABLE "CuratedProductSet" ADD CONSTRAINT "CuratedProductSet_coverMediaObjectId_fkey" FOREIGN KEY ("coverMediaObjectId") REFERENCES "MediaObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CuratedProductSetItem" ADD CONSTRAINT "CuratedProductSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CuratedProductSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CuratedProductSetItem" ADD CONSTRAINT "CuratedProductSetItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
