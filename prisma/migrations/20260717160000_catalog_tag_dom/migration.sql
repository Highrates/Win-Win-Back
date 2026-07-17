-- Rename context tag zhiloe → dom (Жилое → Дом)
UPDATE "CatalogTag"
SET "slug" = 'dom', "name" = 'Дом', "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'zhiloe';
