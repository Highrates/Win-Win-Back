-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "winWinReferralCode" TEXT;

-- В PostgreSQL уникальность: один NULL не конфликтует с другим; частичный уникальный индекс
CREATE UNIQUE INDEX "UserProfile_winWinReferralCode_key" ON "UserProfile"("winWinReferralCode") WHERE "winWinReferralCode" IS NOT NULL;
