-- dashboard не хранится в БД: всегда доступен активным сотрудникам на runtime.
UPDATE "User"
SET "adminSections" = array_remove("adminSections", 'dashboard')
WHERE 'dashboard' = ANY("adminSections");
