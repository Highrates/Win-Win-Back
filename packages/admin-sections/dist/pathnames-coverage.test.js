"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const vitest_1 = require("vitest");
const pathnames_1 = require("./pathnames");
const ADMIN_PAGES_ROOT = (0, node_path_1.join)(__dirname, '../../../frontend/app/(admin)/admin');
/** Маршруты, где null — ожидаемо (login без section guard). */
const PATHNAME_NULL_OK = new Set(['/admin/login']);
function listAdminPageFiles(dir) {
    const out = [];
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const full = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listAdminPageFiles(full));
        }
        else if (entry.name === 'page.tsx') {
            out.push(full);
        }
    }
    return out;
}
/** `app/(admin)/admin/.../page.tsx` → `/admin/...` с sample-id вместо `[param]`. */
function pageFileToPathname(filePath) {
    const rel = (0, node_path_1.relative)(ADMIN_PAGES_ROOT, filePath).replace(/\\/g, '/');
    if (rel === 'page.tsx')
        return '/admin';
    const route = rel.replace(/\/page\.tsx$/, '');
    const withSamples = route.replace(/\[[^\]]+\]/g, 'sample-id');
    return `/admin/${withSamples}`.replace(/\/+/g, '/');
}
(0, vitest_1.describe)('pathnames coverage (Next admin routes)', () => {
    (0, vitest_1.it)('resolves every app/(admin)/admin/**/page.tsx pathname', () => {
        const files = listAdminPageFiles(ADMIN_PAGES_ROOT);
        (0, vitest_1.expect)(files.length).toBeGreaterThan(10);
        const unmapped = [];
        for (const file of files) {
            const pathname = pageFileToPathname(file);
            const section = (0, pathnames_1.resolveAdminSectionFromPathname)(pathname);
            if (section == null && !PATHNAME_NULL_OK.has(pathname)) {
                unmapped.push(`${pathname} ← ${(0, node_path_1.relative)(ADMIN_PAGES_ROOT, file)}`);
            }
        }
        (0, vitest_1.expect)(unmapped, `Add prefix rules in nav-manifest/pathnames for:\n${unmapped.join('\n')}`).toEqual([]);
    });
});
