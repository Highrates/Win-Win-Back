-- Заказ отклонён менеджером (после PENDING_APPROVAL).
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
