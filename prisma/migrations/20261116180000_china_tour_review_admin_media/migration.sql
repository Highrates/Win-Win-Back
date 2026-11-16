-- Admin-authored reviews + photo/video media on ChinaTourReview
ALTER TABLE "ChinaTourReview" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "ChinaTourReview" ADD COLUMN "authorName" TEXT;
ALTER TABLE "ChinaTourReview" ADD COLUMN "photoUrls" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ChinaTourReview" ADD COLUMN "videoUrl" TEXT;
