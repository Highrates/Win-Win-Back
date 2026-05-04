-- Junction кейс ↔ товар + счётчик на товаре; бэкфилл из JSON `Case.productIds`.

ALTER TABLE "Product" ADD COLUMN "casesLinkedCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CaseProduct" (
    "caseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "CaseProduct_pkey" PRIMARY KEY ("caseId","productId"),
    CONSTRAINT "CaseProduct_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CaseProduct_productId_idx" ON "CaseProduct"("productId");

INSERT INTO "CaseProduct" ("caseId", "productId")
SELECT DISTINCT c.id, e
FROM "Case" c
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN c."productIds" IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(c."productIds"::jsonb) = 'array' THEN c."productIds"::jsonb
    ELSE '[]'::jsonb
  END
) AS e
INNER JOIN "Product" p ON p.id = e
ON CONFLICT DO NOTHING;

UPDATE "Product" pr
SET "casesLinkedCount" = COALESCE(cnt.n, 0)
FROM (
  SELECT "productId", COUNT(*)::int AS n
  FROM "CaseProduct"
  GROUP BY "productId"
) cnt
WHERE pr.id = cnt."productId";
