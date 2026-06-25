-- CreateTable
CREATE TABLE "SourcingCommercialProposalLineImage" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SourcingCommercialProposalLineImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingCommercialProposalLineImage_lineId_idx" ON "SourcingCommercialProposalLineImage"("lineId");

-- AddForeignKey
ALTER TABLE "SourcingCommercialProposalLineImage" ADD CONSTRAINT "SourcingCommercialProposalLineImage_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "SourcingCommercialProposalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MigrateData
INSERT INTO "SourcingCommercialProposalLineImage" ("id", "lineId", "url", "sortOrder")
SELECT ('img_' || "id" || '_0'), "id", "imageUrl", 0
FROM "SourcingCommercialProposalLine"
WHERE "imageUrl" IS NOT NULL AND btrim("imageUrl") <> '';

-- AlterTable
ALTER TABLE "SourcingCommercialProposalLine" DROP COLUMN "imageUrl";
