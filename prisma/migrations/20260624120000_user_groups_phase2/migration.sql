-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "slug" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "referralProgramProfileId" TEXT NOT NULL,
    "designerBonusProfileId" TEXT NOT NULL,
    "pricingProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroupMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,

    CONSTRAINT "UserGroupMember_pkey" PRIMARY KEY ("id")
);

-- Order program snapshots (buyer at submit)
ALTER TABLE "Order" ADD COLUMN "buyerReferralProgramProfileIdSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN "buyerDesignerBonusProfileIdSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN "programSnapshotsCapturedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_slug_key" ON "UserGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroupMember_userId_key" ON "UserGroupMember"("userId");

-- CreateIndex
CREATE INDEX "UserGroupMember_groupId_idx" ON "UserGroupMember"("groupId");

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_referralProgramProfileId_fkey" FOREIGN KEY ("referralProgramProfileId") REFERENCES "ReferralProgramProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_designerBonusProfileId_fkey" FOREIGN KEY ("designerBonusProfileId") REFERENCES "DesignerBonusProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "PricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerReferralProgramProfileIdSnapshot_fkey" FOREIGN KEY ("buyerReferralProgramProfileIdSnapshot") REFERENCES "ReferralProgramProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerDesignerBonusProfileIdSnapshot_fkey" FOREIGN KEY ("buyerDesignerBonusProfileIdSnapshot") REFERENCES "DesignerBonusProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
