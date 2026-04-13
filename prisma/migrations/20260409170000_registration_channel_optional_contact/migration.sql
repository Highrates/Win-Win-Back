-- Регистрация: один канал доставки OTP (телефон или email).

CREATE TYPE "RegistrationOtpChannel" AS ENUM ('PHONE', 'EMAIL');

ALTER TABLE "RegistrationChallenge" ADD COLUMN "channel" "RegistrationOtpChannel";

UPDATE "RegistrationChallenge" SET "channel" = 'PHONE' WHERE "channel" IS NULL;

ALTER TABLE "RegistrationChallenge" ALTER COLUMN "channel" SET NOT NULL;

ALTER TABLE "RegistrationChallenge" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "RegistrationChallenge" ALTER COLUMN "email" DROP NOT NULL;
