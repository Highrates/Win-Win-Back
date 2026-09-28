-- Дата вложения заявки на подбор — своя, а не дата заявки (лента «Документы»).

-- AlterTable
ALTER TABLE "SourcingRequestAttachment" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- До этой миграции вложения прикладывались только при создании заявки.
UPDATE "SourcingRequestAttachment" s
SET "createdAt" = r."createdAt"
FROM "SourcingRequest" r
WHERE r."id" = s."requestId";
