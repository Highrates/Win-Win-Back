-- Продакшен (VPS): создать БД winwin (при запущенном PostgreSQL на сервере).
-- Локальная разработка — отдельная БД winwin_dev: prisma/create_database_dev.sql и docs/DEPLOY.md §1.3.
-- Пример: psql -U postgres -h localhost -f prisma/create_database.sql

CREATE DATABASE winwin;
