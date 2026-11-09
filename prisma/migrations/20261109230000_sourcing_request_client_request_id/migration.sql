-- Ключ идемпотентности отправки заявки на подбор (повтор после таймаута не создаёт дубль).
ALTER TABLE "SourcingRequest" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "SourcingRequest_userId_clientRequestId_key" ON "SourcingRequest"("userId", "clientRequestId");
