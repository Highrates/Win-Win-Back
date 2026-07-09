/** Ключи разделов админ-панели (сайдбар + API guard). */

export const ADMIN_SECTION_DASHBOARD = 'dashboard' as const;

export const ADMIN_SECTION_IDS = [
  ADMIN_SECTION_DASHBOARD,
  'catalog',
  'brands',
  'orders',
  'applications',
  'clients',
  'objects',
  'blog',
  'journal',
  'settings',
] as const;

export type AdminSectionId = (typeof ADMIN_SECTION_IDS)[number];

/** Разделы, которые можно назначить MODERATOR через чекбоксы (дашборд — всегда). */
export const MODERATOR_ASSIGNABLE_SECTIONS = ADMIN_SECTION_IDS.filter(
  (id) => id !== ADMIN_SECTION_DASHBOARD,
) as Exclude<AdminSectionId, typeof ADMIN_SECTION_DASHBOARD>[];

export type ModeratorAssignableSectionId = (typeof MODERATOR_ASSIGNABLE_SECTIONS)[number];

export const ALL_MODERATOR_SECTIONS_WITH_DASHBOARD: readonly AdminSectionId[] = [
  ...ADMIN_SECTION_IDS,
];

export function isAdminSectionId(value: string): value is AdminSectionId {
  return (ADMIN_SECTION_IDS as readonly string[]).includes(value);
}

/** Разделы из БД (без dashboard — он только runtime). */
export function normalizeStoredAdminSections(
  raw: readonly string[],
): ModeratorAssignableSectionId[] {
  const seen = new Set<ModeratorAssignableSectionId>();
  for (const item of raw) {
    if (
      isAdminSectionId(item) &&
      item !== ADMIN_SECTION_DASHBOARD &&
      (MODERATOR_ASSIGNABLE_SECTIONS as readonly string[]).includes(item)
    ) {
      seen.add(item as ModeratorAssignableSectionId);
    }
  }
  return MODERATOR_ASSIGNABLE_SECTIONS.filter((id) => seen.has(id));
}

/** @deprecated Prefer normalizeStoredAdminSections for persisted adminSections. */
export function normalizeAdminSections(raw: readonly string[]): AdminSectionId[] {
  return normalizeStoredAdminSections(raw);
}
