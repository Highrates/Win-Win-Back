-- CreateTable
CREATE TABLE "DesignerInvite" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "emailNorm" TEXT NOT NULL,
    "refCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignerInvite_inviterId_createdAt_idx" ON "DesignerInvite"("inviterId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignerInvite_emailNorm_idx" ON "DesignerInvite"("emailNorm");

-- AddForeignKey
ALTER TABLE "DesignerInvite" ADD CONSTRAINT "DesignerInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
