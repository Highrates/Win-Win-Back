-- AlterEnum
ALTER TYPE "ChatConversationKind" ADD VALUE 'SOURCING';

-- AlterTable
ALTER TABLE "ChatConversation" ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN "sourcingRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_sourcingRequestId_key" ON "ChatConversation"("sourcingRequestId");

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
