-- Ответ клиента на опубликованное КП (принятие / правки / отклонение).
CREATE TYPE "CustomerKpDecision" AS ENUM ('ACCEPTED', 'CHANGES_REQUESTED', 'REJECTED');

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "customerKpDecision" "CustomerKpDecision",
  ADD COLUMN IF NOT EXISTS "customerKpDecisionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerKpDecisionVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "customerKpRequisites" JSONB;
