-- replyTo for curated Q→A pairs on public storefront Q&A
ALTER TABLE "ProductQaMessage" ADD COLUMN "replyToMessageId" TEXT;

CREATE INDEX "ProductQaMessage_replyToMessageId_idx" ON "ProductQaMessage"("replyToMessageId");

ALTER TABLE "ProductQaMessage" ADD CONSTRAINT "ProductQaMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "ProductQaMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
