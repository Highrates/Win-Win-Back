-- Denormalized last activity for admin chat-products inbox (DB-level pagination).
ALTER TABLE "Product" ADD COLUMN "lastChatActivityAt" TIMESTAMP(3);

UPDATE "Product" p
SET "lastChatActivityAt" = sub.max_at
FROM (
  SELECT
    x."productId",
    MAX(x.last_at) AS max_at
  FROM (
    SELECT c."productId", c."lastMessageAt" AS last_at
    FROM "ProductCorrespondence" c
    UNION ALL
    SELECT t."productId", m."createdAt" AS last_at
    FROM "ProductQaMessage" m
    INNER JOIN "ProductQaThread" t ON t.id = m."threadId"
  ) x
  GROUP BY x."productId"
) sub
WHERE p.id = sub."productId";

CREATE INDEX "Product_lastChatActivityAt_idx" ON "Product" ("lastChatActivityAt" DESC);

-- Partial index for queue metrics: unpublished USER correspondence messages.
CREATE INDEX "ProductCorrespondenceMessage_awaiting_publish_idx"
ON "ProductCorrespondenceMessage" ("correspondenceId")
WHERE "authorRole" = 'USER' AND "publishedQaMessageId" IS NULL;
