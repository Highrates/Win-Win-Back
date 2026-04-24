-- CreateTable
CREATE TABLE "AccountContactChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "RegistrationOtpChannel" NOT NULL,
    "newPhone" TEXT,
    "newEmail" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountContactChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountContactChallenge_userId_idx" ON "AccountContactChallenge"("userId");

-- CreateIndex
CREATE INDEX "AccountContactChallenge_newPhone_idx" ON "AccountContactChallenge"("newPhone");

-- CreateIndex
CREATE INDEX "AccountContactChallenge_newEmail_idx" ON "AccountContactChallenge"("newEmail");

-- AddForeignKey
ALTER TABLE "AccountContactChallenge" ADD CONSTRAINT "AccountContactChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
