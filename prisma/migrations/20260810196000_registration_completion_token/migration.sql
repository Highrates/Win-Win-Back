-- CreateTable
CREATE TABLE "RegistrationCompletionToken" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "consentPersonalData" BOOLEAN NOT NULL,
    "consentSms" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationCompletionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationCompletionToken_expiresAt_idx" ON "RegistrationCompletionToken"("expiresAt");
