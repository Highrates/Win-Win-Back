-- AlterTable
ALTER TABLE "DesignerInvite" ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectReason" TEXT;
