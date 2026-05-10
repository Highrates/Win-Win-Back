-- Новые статусы заказа (черновик ЛК и отправка на согласование)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

-- Поля заказа и строки (снимок как в проекте комплектации)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'шт';
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "snapshot" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
