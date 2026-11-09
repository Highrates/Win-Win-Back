-- Пользователь, подавший claim в очередь админа (approve по id, не по текущему email).
ALTER TABLE "DesignerInvite" ADD COLUMN "claimantUserId" TEXT;

CREATE INDEX "DesignerInvite_claimantUserId_idx" ON "DesignerInvite"("claimantUserId");

ALTER TABLE "DesignerInvite"
  ADD CONSTRAINT "DesignerInvite_claimantUserId_fkey"
  FOREIGN KEY ("claimantUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
