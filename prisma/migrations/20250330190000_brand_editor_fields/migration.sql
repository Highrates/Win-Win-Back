-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "coverImageUrl" TEXT,
ADD COLUMN "backgroundImageUrl" TEXT,
ADD COLUMN "galleryImageUrls" JSONB,
ADD COLUMN "seoTitle" TEXT,
ADD COLUMN "seoDescription" TEXT;
