-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "city" TEXT,
ADD COLUMN     "services" JSONB,
ADD COLUMN     "aboutHtml" TEXT,
ADD COLUMN     "coverLayout" TEXT,
ADD COLUMN     "coverImageUrls" JSONB,
ADD COLUMN     "profileOnboardingPending" BOOLEAN NOT NULL DEFAULT true;

-- Существующие пользователи не должны внезапно получить «первый визит»
UPDATE "UserProfile" SET "profileOnboardingPending" = false;
