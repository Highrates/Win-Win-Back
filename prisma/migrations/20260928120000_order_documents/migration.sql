-- CreateTable
CREATE TABLE "OrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderDocument_orderId_kind_key" ON "OrderDocument"("orderId", "kind");

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Перенос Order.documentUrls ({ kind: url }). Реальная дата загрузки не хранилась —
-- фиксируем updatedAt заказа на момент миграции, дальше она не «плывёт».
INSERT INTO "OrderDocument" ("id", "orderId", "kind", "url", "uploadedAt")
SELECT
    'od' || substr(md5(o."id" || ':' || d.key), 1, 23),
    o."id",
    d.key,
    btrim(d.value),
    o."updatedAt"
FROM "Order" o
CROSS JOIN LATERAL jsonb_each_text(o."documentUrls") AS d(key, value)
WHERE o."documentUrls" IS NOT NULL
  AND jsonb_typeof(o."documentUrls") = 'object'
  AND jsonb_typeof(o."documentUrls" -> d.key) = 'string'
  AND btrim(d.value) <> '';

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "documentUrls";
