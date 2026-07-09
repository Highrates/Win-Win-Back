-- Staff admin sections: display name, permissions, last admin login.

ALTER TABLE "User" ADD COLUMN "staffDisplayName" TEXT;
ALTER TABLE "User" ADD COLUMN "adminSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "lastAdminLoginAt" TIMESTAMP(3);

-- Существующим MODERATOR — все разделы (кроме staff, он только у ADMIN).
UPDATE "User"
SET "adminSections" = ARRAY[
  'catalog',
  'brands',
  'orders',
  'applications',
  'clients',
  'objects',
  'blog',
  'journal',
  'settings'
]::TEXT[]
WHERE role = 'MODERATOR';
