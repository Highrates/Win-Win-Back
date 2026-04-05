-- Раньше в volumeLiters хранились литры (мм³ / 10⁶). Теперь — м³ (мм³ / 10⁹): делим на 1000.
UPDATE "Product" SET "volumeLiters" = "volumeLiters" / 1000 WHERE "volumeLiters" IS NOT NULL;
