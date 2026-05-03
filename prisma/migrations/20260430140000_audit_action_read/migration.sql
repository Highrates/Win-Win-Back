-- Доменный аудит просмотра (GET не проходит через HTTP-аудит мутаций).
ALTER TYPE "AuditAction" ADD VALUE 'READ';
