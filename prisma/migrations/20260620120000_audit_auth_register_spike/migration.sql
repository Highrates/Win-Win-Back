-- Регистрация и rate-limit на auth-ручках (журнал + алерты по всплескам 401/429).
ALTER TYPE "AuditAction" ADD VALUE 'REGISTER';
ALTER TYPE "AuditAction" ADD VALUE 'REGISTER_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTH_RATE_LIMITED';
