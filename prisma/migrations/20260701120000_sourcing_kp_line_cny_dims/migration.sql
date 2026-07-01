-- AlterTable
ALTER TABLE "SourcingCommercialProposalLine"
ADD COLUMN "costPriceCny" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "grossWeightKg" DECIMAL(10,3),
ADD COLUMN "volumeM3" DECIMAL(10,6);
