/** Ключи разделов админ-панели (сайдбар + API guard). */
export declare const ADMIN_SECTION_DASHBOARD: "dashboard";
export declare const ADMIN_SECTION_IDS: readonly ["dashboard", "catalog", "brands", "orders", "applications", "clients", "objects", "blog", "journal", "settings"];
export type AdminSectionId = (typeof ADMIN_SECTION_IDS)[number];
/** Разделы, которые можно назначить MODERATOR через чекбоксы (дашборд — всегда). */
export declare const MODERATOR_ASSIGNABLE_SECTIONS: Exclude<AdminSectionId, typeof ADMIN_SECTION_DASHBOARD>[];
export type ModeratorAssignableSectionId = (typeof MODERATOR_ASSIGNABLE_SECTIONS)[number];
export declare const ALL_MODERATOR_SECTIONS_WITH_DASHBOARD: readonly AdminSectionId[];
export declare function isAdminSectionId(value: string): value is AdminSectionId;
/** Разделы из БД (без dashboard — он только runtime). */
export declare function normalizeStoredAdminSections(raw: readonly string[]): ModeratorAssignableSectionId[];
/** @deprecated Prefer normalizeStoredAdminSections for persisted adminSections. */
export declare function normalizeAdminSections(raw: readonly string[]): AdminSectionId[];
