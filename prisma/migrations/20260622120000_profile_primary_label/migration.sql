-- Переименование seed-профилей «По умолчанию» → «Основной» (UI-метка isDefault)
UPDATE "ReferralProgramProfile"
SET "name" = 'Основной'
WHERE "isDefault" = true AND "name" = 'По умолчанию';

UPDATE "DesignerBonusProfile"
SET "name" = 'Основной'
WHERE "isDefault" = true AND "name" = 'По умолчанию';
