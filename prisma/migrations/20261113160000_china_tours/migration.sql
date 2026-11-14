-- CreateEnum
CREATE TYPE "ChinaTourImageRole" AS ENUM ('CARD_PRIMARY', 'CARD_SECONDARY', 'DAY_HERO', 'DAY_GALLERY');

-- CreateEnum
CREATE TYPE "ChinaTourApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChinaTourReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ChinaToursLanding" (
    "id" TEXT NOT NULL DEFAULT 'landing',
    "title" TEXT NOT NULL DEFAULT 'WUPAPA ОРГАНИЗОВЫВАЕТ МЕБЕЛЬНЫЕ ТУРЫ В КИТАЙ',
    "paragraph1" TEXT NOT NULL DEFAULT '',
    "paragraph2" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChinaToursLanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTour" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cardText" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "seatsTotal" INTEGER NOT NULL DEFAULT 10,
    "seatsTaken" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChinaTour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTourDay" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChinaTourDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTourScheduleItem" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "timeLabel" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChinaTourScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTourImage" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "dayId" TEXT,
    "url" TEXT NOT NULL,
    "role" "ChinaTourImageRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChinaTourImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTourApplication" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT,
    "status" "ChinaTourApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChinaTourApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChinaTourReview" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" INTEGER,
    "status" "ChinaTourReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChinaTourReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChinaTour_slug_key" ON "ChinaTour"("slug");

-- CreateIndex
CREATE INDEX "ChinaTour_isPublished_startsAt_idx" ON "ChinaTour"("isPublished", "startsAt");

-- CreateIndex
CREATE INDEX "ChinaTour_sortOrder_idx" ON "ChinaTour"("sortOrder");

-- CreateIndex
CREATE INDEX "ChinaTourDay_tourId_sortOrder_idx" ON "ChinaTourDay"("tourId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ChinaTourDay_tourId_dayNumber_key" ON "ChinaTourDay"("tourId", "dayNumber");

-- CreateIndex
CREATE INDEX "ChinaTourScheduleItem_dayId_sortOrder_idx" ON "ChinaTourScheduleItem"("dayId", "sortOrder");

-- CreateIndex
CREATE INDEX "ChinaTourImage_tourId_role_idx" ON "ChinaTourImage"("tourId", "role");

-- CreateIndex
CREATE INDEX "ChinaTourImage_dayId_idx" ON "ChinaTourImage"("dayId");

-- CreateIndex
CREATE INDEX "ChinaTourApplication_status_createdAt_idx" ON "ChinaTourApplication"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChinaTourApplication_tourId_userId_key" ON "ChinaTourApplication"("tourId", "userId");

-- CreateIndex
CREATE INDEX "ChinaTourReview_tourId_status_idx" ON "ChinaTourReview"("tourId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChinaTourReview_tourId_userId_key" ON "ChinaTourReview"("tourId", "userId");

-- AddForeignKey
ALTER TABLE "ChinaTourDay" ADD CONSTRAINT "ChinaTourDay_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "ChinaTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourScheduleItem" ADD CONSTRAINT "ChinaTourScheduleItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ChinaTourDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourImage" ADD CONSTRAINT "ChinaTourImage_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "ChinaTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourImage" ADD CONSTRAINT "ChinaTourImage_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ChinaTourDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourApplication" ADD CONSTRAINT "ChinaTourApplication_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "ChinaTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourApplication" ADD CONSTRAINT "ChinaTourApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourReview" ADD CONSTRAINT "ChinaTourReview_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "ChinaTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourReview" ADD CONSTRAINT "ChinaTourReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed landing singleton
INSERT INTO "ChinaToursLanding" ("id", "title", "paragraph1", "paragraph2", "updatedAt")
VALUES (
  'landing',
  'WUPAPA ОРГАНИЗОВЫВАЕТ МЕБЕЛЬНЫЕ ТУРЫ В КИТАЙ',
  '',
  '',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
