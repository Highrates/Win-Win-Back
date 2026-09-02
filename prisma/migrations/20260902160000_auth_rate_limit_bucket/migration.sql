-- DB-backed OTP start rate limits (multi-instance safe)
CREATE TABLE IF NOT EXISTS "AuthRateLimitBucket" (
    "bucketKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("bucketKey")
);

CREATE INDEX IF NOT EXISTS "AuthRateLimitBucket_windowEnd_idx" ON "AuthRateLimitBucket"("windowEnd");
