-- Epic 2: редактирование body + audit revisions (public Q&A + correspondence)

ALTER TABLE "ProductQaMessage" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "ProductQaMessage" ADD COLUMN "editedByUserId" TEXT;

ALTER TABLE "ProductCorrespondenceMessage" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "ProductCorrespondenceMessage" ADD COLUMN "editedByUserId" TEXT;

CREATE TABLE "ProductQaMessageRevision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQaMessageRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductCorrespondenceMessageRevision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCorrespondenceMessageRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductQaMessageRevision_messageId_createdAt_idx" ON "ProductQaMessageRevision"("messageId", "createdAt" DESC);

CREATE INDEX "ProductCorrespondenceMessageRevision_messageId_createdAt_idx" ON "ProductCorrespondenceMessageRevision"("messageId", "createdAt" DESC);

ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductCorrespondenceMessage" ADD CONSTRAINT "ProductCorrespondenceMessage_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductQaMessageRevision" ADD CONSTRAINT "ProductQaMessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProductQaMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductQaMessageRevision" ADD CONSTRAINT "ProductQaMessageRevision_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCorrespondenceMessageRevision" ADD CONSTRAINT "ProductCorrespondenceMessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProductCorrespondenceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCorrespondenceMessageRevision" ADD CONSTRAINT "ProductCorrespondenceMessageRevision_editedByUserId_fkey" FOREIGN KEY ("editedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
