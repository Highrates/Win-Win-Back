-- Регистрация: OTP (SMS + email) и согласия при создании пользователя.

ALTER TABLE "User" ADD COLUMN "consentPersonalDataAcceptedAt" TIMESTAMP(3),
ADD COLUMN "consentSmsMarketingAcceptedAt" TIMESTAMP(3);

CREATE TABLE "RegistrationChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consentPersonalData" BOOLEAN NOT NULL,
    "consentSms" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistrationChallenge_phone_idx" ON "RegistrationChallenge"("phone");

CREATE INDEX "RegistrationChallenge_email_idx" ON "RegistrationChallenge"("email");
