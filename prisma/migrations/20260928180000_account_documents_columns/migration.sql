-- Лента «Документы» (GET /account/documents): признак документа, нормализованное имя для поиска,
-- владелец и дата у вложений чата — чтобы выборка шла по индексу без джойна на заказ / заявку.

-- AlterTable
ALTER TABLE "ChatAttachment" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isDocument" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "searchName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SourcingRequestAttachment" ADD COLUMN     "isDocument" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "searchName" TEXT NOT NULL DEFAULT '';

-- Backfill: те же правила, что в document-fields.ts (isNonMediaDocument / documentSearchName).
-- Кириллица переводится в нижний регистр явно: lower() зависит от LC_CTYPE базы.
UPDATE "ChatAttachment" a
SET "createdAt" = m."createdAt",
    "ownerUserId" = COALESCE(o."userId", sr."userId")
FROM "ChatMessage" m
JOIN "ChatConversation" c ON c."id" = m."conversationId"
LEFT JOIN "Order" o ON o."id" = c."orderId"
LEFT JOIN "SourcingRequest" sr ON sr."id" = c."sourcingRequestId"
WHERE m."id" = a."messageId";

UPDATE "ChatAttachment"
SET "searchName" = translate(lower(translate(btrim("filename"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя')), 'ё', 'е'),
    "isDocument" = "kind" = 'FILE'
      AND lower(COALESCE("mimeType", '')) !~ '^(image|video|audio)/'
      AND lower(btrim("filename")) !~ '\.(jpg|jpeg|png|gif|webp|avif|heic|heif|bmp|svg|tif|tiff|mp4|mov|webm|m4v|avi|mkv|mp3|wav|ogg|m4a|aac|flac)$';

UPDATE "SourcingRequestAttachment"
SET "searchName" = translate(lower(translate(btrim("filename"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя')), 'ё', 'е'),
    "isDocument" = lower(COALESCE("mimeType", '')) !~ '^(image|video|audio)/'
      AND lower(btrim("filename")) !~ '\.(jpg|jpeg|png|gif|webp|avif|heic|heif|bmp|svg|tif|tiff|mp4|mov|webm|m4v|avi|mkv|mp3|wav|ogg|m4a|aac|flac)$';

-- DropIndex
DROP INDEX "SourcingRequestAttachment_requestId_idx";

-- CreateIndex
CREATE INDEX "ChatAttachment_ownerUserId_isDocument_createdAt_id_idx" ON "ChatAttachment"("ownerUserId", "isDocument", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "SourcingRequestAttachment_requestId_isDocument_idx" ON "SourcingRequestAttachment"("requestId", "isDocument");
