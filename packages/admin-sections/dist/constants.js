"use strict";
/** Ключи разделов админ-панели (сайдбар + API guard). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_MODERATOR_SECTIONS_WITH_DASHBOARD = exports.MODERATOR_ASSIGNABLE_SECTIONS = exports.ADMIN_SECTION_IDS = exports.ADMIN_SECTION_DASHBOARD = void 0;
exports.isAdminSectionId = isAdminSectionId;
exports.normalizeStoredAdminSections = normalizeStoredAdminSections;
exports.normalizeAdminSections = normalizeAdminSections;
exports.ADMIN_SECTION_DASHBOARD = 'dashboard';
exports.ADMIN_SECTION_IDS = [
    exports.ADMIN_SECTION_DASHBOARD,
    'catalog',
    'brands',
    'orders',
    'applications',
    'clients',
    'objects',
    'blog',
    'journal',
    'settings',
];
/** Разделы, которые можно назначить MODERATOR через чекбоксы (дашборд — всегда). */
exports.MODERATOR_ASSIGNABLE_SECTIONS = exports.ADMIN_SECTION_IDS.filter((id) => id !== exports.ADMIN_SECTION_DASHBOARD);
exports.ALL_MODERATOR_SECTIONS_WITH_DASHBOARD = [
    ...exports.ADMIN_SECTION_IDS,
];
function isAdminSectionId(value) {
    return exports.ADMIN_SECTION_IDS.includes(value);
}
/** Разделы из БД (без dashboard — он только runtime). */
function normalizeStoredAdminSections(raw) {
    const seen = new Set();
    for (const item of raw) {
        if (isAdminSectionId(item) &&
            item !== exports.ADMIN_SECTION_DASHBOARD &&
            exports.MODERATOR_ASSIGNABLE_SECTIONS.includes(item)) {
            seen.add(item);
        }
    }
    return exports.MODERATOR_ASSIGNABLE_SECTIONS.filter((id) => seen.has(id));
}
/** @deprecated Prefer normalizeStoredAdminSections for persisted adminSections. */
function normalizeAdminSections(raw) {
    return normalizeStoredAdminSections(raw);
}
