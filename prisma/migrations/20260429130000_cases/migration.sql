-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "caseRoomTypeOptions" JSONB;

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" VARCHAR(220),
    "location" TEXT,
    "year" INTEGER,
    "budget" TEXT,
    "descriptionHtml" TEXT,
    "coverLayout" TEXT,
    "coverImageUrls" JSONB,
    "roomTypes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Case_userId_createdAt_idx" ON "Case"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

