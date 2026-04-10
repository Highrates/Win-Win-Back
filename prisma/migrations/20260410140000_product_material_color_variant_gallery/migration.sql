-- CreateTable
CREATE TABLE "ProductMaterialOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMaterialOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductColorOption" (
    "id" TEXT NOT NULL,
    "materialOptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductColorOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantProductImage" (
    "variantId" TEXT NOT NULL,
    "productImageId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantProductImage_pkey" PRIMARY KEY ("variantId","productImageId")
);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "variantLabel" TEXT,
ADD COLUMN     "variantSlug" TEXT,
ADD COLUMN     "materialOptionId" TEXT,
ADD COLUMN     "colorOptionId" TEXT;

-- CreateIndex
CREATE INDEX "ProductMaterialOption_productId_idx" ON "ProductMaterialOption"("productId");

-- CreateIndex
CREATE INDEX "ProductColorOption_materialOptionId_idx" ON "ProductColorOption"("materialOptionId");

-- CreateIndex
CREATE INDEX "ProductVariantProductImage_variantId_idx" ON "ProductVariantProductImage"("variantId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_variantSlug_idx" ON "ProductVariant"("productId", "variantSlug");

-- AddForeignKey
ALTER TABLE "ProductMaterialOption" ADD CONSTRAINT "ProductMaterialOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductColorOption" ADD CONSTRAINT "ProductColorOption_materialOptionId_fkey" FOREIGN KEY ("materialOptionId") REFERENCES "ProductMaterialOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantProductImage" ADD CONSTRAINT "ProductVariantProductImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantProductImage" ADD CONSTRAINT "ProductVariantProductImage_productImageId_fkey" FOREIGN KEY ("productImageId") REFERENCES "ProductImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_materialOptionId_fkey" FOREIGN KEY ("materialOptionId") REFERENCES "ProductMaterialOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorOptionId_fkey" FOREIGN KEY ("colorOptionId") REFERENCES "ProductColorOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
