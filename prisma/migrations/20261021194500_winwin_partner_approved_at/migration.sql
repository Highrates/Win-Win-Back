-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "winWinPartnerApprovedAt" TIMESTAMP(3);

-- Backfill: уже одобренные партнёры (приблизительно по updatedAt профиля)
UPDATE "UserProfile"
SET "winWinPartnerApprovedAt" = COALESCE("updatedAt", "partnerApplicationSubmittedAt", NOW())
WHERE "winWinPartnerApproved" = true
  AND "winWinPartnerApprovedAt" IS NULL;
