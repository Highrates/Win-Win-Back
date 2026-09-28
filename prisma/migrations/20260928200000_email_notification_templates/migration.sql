-- Редактируемые email-уведомления. Строки создаются сервисом при старте (ensureDefaults).

-- CreateTable
CREATE TABLE "EmailNotificationTemplate" (
    "eventKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lastSendPath" TEXT,
    "lastSendAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "lastEditedByEmail" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailNotificationTemplate_pkey" PRIMARY KEY ("eventKey")
);

-- CreateTable
CREATE TABLE "EmailNotificationTemplateRevision" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailNotificationTemplateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailNotificationTemplateRevision_eventKey_createdAt_idx" ON "EmailNotificationTemplateRevision"("eventKey", "createdAt");
