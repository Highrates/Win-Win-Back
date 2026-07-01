-- Snapshot профиля ценообразования на момент публикации КП.
ALTER TABLE "SourcingCommercialProposal" ADD COLUMN "pricingProfileUpdatedAt" TIMESTAMP(3);
