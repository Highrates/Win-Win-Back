-- Новый жизненный цикл статусов заказа (10 этапов + DRAFT).
-- Частичный индекс по status = 'DRAFT' нужно снять до смены типа enum.
DROP INDEX IF EXISTS "Order_userId_draft_unique";

CREATE TYPE "OrderStatus_new" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PENDING_SIGNATURE',
  'PENDING_PAYMENT',
  'PAID',
  'PENDING_SHIPMENT',
  'IN_TRANSIT',
  'DELIVERED_TO_RU_WAREHOUSE',
  'RECEIVED',
  'COMPLETED'
);

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;

-- Через text, чтобы PostgreSQL не сравнивал старый и новый enum в USING.
ALTER TABLE "Order" ALTER COLUMN "status" TYPE text USING ("status"::text);

ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
  CASE "status"
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
    WHEN 'ORDERED' THEN 'APPROVED'
    WHEN 'PAID' THEN 'PAID'
    WHEN 'RECEIVED' THEN 'RECEIVED'
    WHEN 'REJECTED' THEN 'PENDING_APPROVAL'
    ELSE 'PENDING_APPROVAL'
  END::"OrderStatus_new"
);

ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL'::"OrderStatus_new";

DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";

CREATE UNIQUE INDEX "Order_userId_draft_unique" ON "Order" ("userId") WHERE (status = 'DRAFT');

ALTER TABLE "SiteSettings" DROP COLUMN IF EXISTS "orderStatusLabels";
