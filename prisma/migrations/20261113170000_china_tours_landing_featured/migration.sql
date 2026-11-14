-- Лендинг: одно описание + выбранные туры вместо двух абзацев
ALTER TABLE "ChinaToursLanding" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChinaToursLanding" ADD COLUMN IF NOT EXISTS "featuredTourIds" JSONB;

UPDATE "ChinaToursLanding"
SET "description" = TRIM(BOTH E'\n' FROM CONCAT(COALESCE("paragraph1", ''), E'\n\n', COALESCE("paragraph2", '')))
WHERE COALESCE("description", '') = ''
  AND (COALESCE("paragraph1", '') <> '' OR COALESCE("paragraph2", '') <> '');

ALTER TABLE "ChinaToursLanding" DROP COLUMN IF EXISTS "paragraph1";
ALTER TABLE "ChinaToursLanding" DROP COLUMN IF EXISTS "paragraph2";
