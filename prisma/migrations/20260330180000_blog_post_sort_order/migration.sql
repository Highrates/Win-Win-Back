-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: прежний порядок списка (publishedAt desc, createdAt desc) → sortOrder 0,1,2,…
UPDATE "BlogPost" AS p
SET "sortOrder" = x.rn
FROM (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY "publishedAt" DESC NULLS LAST, "createdAt" DESC) - 1) AS rn
  FROM "BlogPost"
) AS x
WHERE p.id = x.id;
