-- CreateTable
CREATE TABLE "SourcingCommercialProposal" (
    "id" TEXT NOT NULL,
    "sourcingRequestId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "CommercialProposalStatus" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingCommercialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingCommercialProposalLine" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "sourceSourcingRequestItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "offerUnitPrice" DECIMAL(12,2) NOT NULL,
    "deliveryEta" TEXT,

    CONSTRAINT "SourcingCommercialProposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingCommercialProposal_sourcingRequestId_status_idx" ON "SourcingCommercialProposal"("sourcingRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingCommercialProposal_sourcingRequestId_versionNumber_key" ON "SourcingCommercialProposal"("sourcingRequestId", "versionNumber");

-- CreateIndex
CREATE INDEX "SourcingCommercialProposalLine_proposalId_idx" ON "SourcingCommercialProposalLine"("proposalId");

-- AddForeignKey
ALTER TABLE "SourcingCommercialProposal" ADD CONSTRAINT "SourcingCommercialProposal_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingCommercialProposal" ADD CONSTRAINT "SourcingCommercialProposal_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingCommercialProposalLine" ADD CONSTRAINT "SourcingCommercialProposalLine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SourcingCommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
