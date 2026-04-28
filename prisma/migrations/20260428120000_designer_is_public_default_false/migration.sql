-- Новые записи Designer не публикуются по умолчанию; явная публикация через переключатель.
ALTER TABLE "Designer" ALTER COLUMN "isPublic" SET DEFAULT false;
