-- Локальная разработка: отдельная БД winwin_dev (на VPS прод обычно winwin).
-- Роль winwin должна существовать, например:
--   CREATE ROLE winwin WITH LOGIN PASSWORD 'admin-winwin';
-- Выполните от суперпользователя PostgreSQL, например:
--   psql -U postgres -h localhost -f prisma/create_database_dev.sql

CREATE DATABASE winwin_dev OWNER winwin;
