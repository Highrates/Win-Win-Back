"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAdminSectionFromPathname = resolveAdminSectionFromPathname;
exports.staffCanAccessAdminPath = staffCanAccessAdminPath;
const constants_1 = require("./constants");
const nav_manifest_1 = require("./nav-manifest");
/** Next.js pathname админки, напр. `/admin/orders/sourcing/abc`. */
function resolveAdminSectionFromPathname(pathname) {
    const p = pathname.replace(/\/+$/, '') || '/';
    if (p === '/admin/login')
        return null;
    if (p === '/admin/settings/staff/me')
        return constants_1.ADMIN_SECTION_DASHBOARD;
    if (p === '/admin')
        return constants_1.ADMIN_SECTION_DASHBOARD;
    if (p === '/admin/settings/staff' || p.startsWith('/admin/settings/staff/')) {
        return 'staff';
    }
    for (const rule of (0, nav_manifest_1.collectAdminPathPrefixRules)()) {
        if (p === rule.prefix || p.startsWith(`${rule.prefix}/`)) {
            return rule.section;
        }
    }
    return null;
}
function staffCanAccessAdminPath(pathname, sections, isSuperAdmin) {
    const p = pathname.replace(/\/+$/, '') || '/';
    if (p === '/admin/login')
        return true;
    if (isSuperAdmin)
        return true;
    const target = resolveAdminSectionFromPathname(pathname);
    if (target == null)
        return false;
    if (target === 'staff')
        return false;
    if (target === constants_1.ADMIN_SECTION_DASHBOARD)
        return true;
    return sections.includes(target);
}
