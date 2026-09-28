-- В БД — только правки админа; NULL означает «текст по умолчанию из кода».

-- AlterTable
ALTER TABLE "EmailNotificationTemplate" ALTER COLUMN "subject" DROP NOT NULL,
ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "body" DROP NOT NULL;

-- Строки, которые сервис создал при старте с текстами по умолчанию, админ не правил.
UPDATE "EmailNotificationTemplate"
SET "subject" = NULL, "title" = NULL, "body" = NULL
WHERE "lastEditedAt" IS NULL;
