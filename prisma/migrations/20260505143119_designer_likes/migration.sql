-- Designer likes: real-only counters + user↔designer likes table

ALTER TABLE "Designer"
ADD COLUMN IF NOT EXISTS "likesUserCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "DesignerLike" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "designerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DesignerLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DesignerLike_userId_designerId_key"
ON "DesignerLike"("userId", "designerId");

CREATE INDEX IF NOT EXISTS "DesignerLike_designerId_idx"
ON "DesignerLike"("designerId");

DO $$
BEGIN
  ALTER TABLE "DesignerLike"
  ADD CONSTRAINT "DesignerLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DesignerLike"
  ADD CONSTRAINT "DesignerLike_designerId_fkey"
  FOREIGN KEY ("designerId") REFERENCES "Designer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Safety: keep counter non-negative
UPDATE "Designer" SET "likesUserCount" = 0 WHERE "likesUserCount" < 0;

DO $$
BEGIN
  ALTER TABLE "Designer" ADD CONSTRAINT "Designer_likesUserCount_nonneg" CHECK ("likesUserCount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

