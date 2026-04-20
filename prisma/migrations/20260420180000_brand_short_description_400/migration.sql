-- Align Brand.shortDescription with admin/API limit (400 chars).
ALTER TABLE "Brand" ALTER COLUMN "shortDescription" TYPE VARCHAR(400);
