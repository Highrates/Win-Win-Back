-- AlterTable
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastErrorPath" TEXT,
ADD COLUMN "lastErrorAt" TIMESTAMP(3),
ADD COLUMN "lastErrorMessage" TEXT;
