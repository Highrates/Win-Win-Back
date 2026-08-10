-- Queue metrics: pending USER questions awaiting moderation.
CREATE INDEX "ProductQaMessage_pending_user_idx"
ON "ProductQaMessage" ("threadId", "createdAt" DESC)
WHERE status = 'PENDING' AND "authorRole" = 'USER';
