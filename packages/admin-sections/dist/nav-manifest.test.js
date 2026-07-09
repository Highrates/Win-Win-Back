"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const nav_manifest_1 = require("./nav-manifest");
const pathnames_1 = require("./pathnames");
(0, vitest_1.describe)('nav manifest pathnames', () => {
    (0, vitest_1.it)('resolves every manifest href to a section', () => {
        const hrefs = (0, nav_manifest_1.collectAdminNavHrefs)();
        (0, vitest_1.expect)(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            const section = (0, pathnames_1.resolveAdminSectionFromPathname)(href);
            (0, vitest_1.expect)(section, `href ${href} must resolve`).not.toBeNull();
        }
    });
    (0, vitest_1.it)('resolves nested admin paths under manifest hrefs', () => {
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/orders/sourcing/abc')).toBe('orders');
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/catalog/products/new')).toBe('catalog');
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/settings/staff/me')).toBe('dashboard');
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/settings/staff')).toBe('staff');
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/modeling')).toBe('catalog');
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/designer-projects/abc')).toBe('clients');
    });
});
