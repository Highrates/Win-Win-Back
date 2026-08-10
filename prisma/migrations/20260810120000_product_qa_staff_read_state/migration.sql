-- AlterEnum
ALTER TYPE "ProductQaMessageStatus" ADD VALUE 'PENDING';

-- CreateTable
CREATE TABLE "ProductQaStaffReadState" (
    "staffUserId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductQaStaffReadState_pkey" PRIMARY KEY ("staffUserId","productId")
);

-- CreateIndex
CREATE INDEX "ProductQaStaffReadState_staffUserId_idx" ON "ProductQaStaffReadState"("staffUserId");

-- AddForeignKey
ALTER TABLE "ProductQaStaffReadState" ADD CONSTRAINT "ProductQaStaffReadState_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQaStaffReadState" ADD CONSTRAINT "ProductQaStaffReadState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
