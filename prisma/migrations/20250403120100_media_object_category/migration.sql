-- CreateEnum
CREATE TYPE "MediaLibraryCategory" AS ENUM ('IMAGE', 'DOCUMENT', 'MODEL', 'VIDEO', 'OTHER');

-- AlterTable
ALTER TABLE "MediaObject" ADD COLUMN "category" "MediaLibraryCategory" NOT NULL DEFAULT 'OTHER';
