-- Раньше здесь был UPDATE по "volumeLiters", но колонка создаётся только в 20260405120000_product_extended_fields.
-- Конвертация литры → м³ выполняется в конце той миграции (после ADD COLUMN).
SELECT 1;
