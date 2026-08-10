-- Denormalized QA counter on Product (for catalog / Meilisearch).
ALTER TABLE "Product" ADD COLUMN "qaMessageCountPublic" INTEGER NOT NULL DEFAULT 0;

UPDATE "Product" p
SET "qaMessageCountPublic" = t."messageCountPublic"
FROM "ProductQaThread" t
WHERE t."productId" = p.id;
