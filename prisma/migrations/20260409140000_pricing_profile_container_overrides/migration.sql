-- Optional overrides for container limits (90% applied in app from these max values)
ALTER TABLE "PricingProfile" ADD COLUMN "containerMaxWeightKg" DECIMAL(14,4);
ALTER TABLE "PricingProfile" ADD COLUMN "containerMaxVolumeM3" DECIMAL(14,6);
