-- Слить дубликаты DRAFT на пользователя: строки переносим в самый свежий черновик, лишние заказы удаляем.
WITH ranked AS (
  SELECT
    id,
    "userId",
    ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, id DESC) AS rn
  FROM "Order"
  WHERE status = 'DRAFT'
),
keepers AS (
  SELECT id AS keep_id, "userId" FROM ranked WHERE rn = 1
),
losers AS (
  SELECT id AS lose_id, "userId" FROM ranked WHERE rn > 1
)
UPDATE "OrderItem" AS oi
SET "orderId" = k.keep_id
FROM losers l
JOIN keepers k ON k."userId" = l."userId"
WHERE oi."orderId" = l.lose_id;

DELETE FROM "Order" o
WHERE o.status = 'DRAFT'
  AND o.id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, id DESC) AS rn
      FROM "Order"
      WHERE status = 'DRAFT'
    ) sub
    WHERE sub.rn > 1
  );

-- Один активный черновик на пользователя (частичный уникальный индекс)
CREATE UNIQUE INDEX IF NOT EXISTS "Order_userId_draft_unique" ON "Order" ("userId") WHERE (status = 'DRAFT');
