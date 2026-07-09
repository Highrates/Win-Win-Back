"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const api_paths_1 = require("./api-paths");
const constants_1 = require("./constants");
const pathnames_1 = require("./pathnames");
(0, vitest_1.describe)('admin-sections', () => {
    (0, vitest_1.it)('normalizes stored section ids without dashboard', () => {
        (0, vitest_1.expect)((0, constants_1.normalizeStoredAdminSections)(['orders', 'bogus', 'orders'])).toEqual(['orders']);
        (0, vitest_1.expect)((0, constants_1.normalizeStoredAdminSections)(['dashboard', 'orders'])).toEqual(['orders']);
    });
    (0, vitest_1.it)('maps api paths', () => {
        (0, vitest_1.expect)((0, api_paths_1.resolveAdminSectionFromApiPath)('/api/v1/catalog/admin/products')).toBe('catalog');
        (0, vitest_1.expect)((0, api_paths_1.resolveAdminSectionFromApiPath)('/api/v1/catalog/admin/brands/x')).toBe('brands');
        (0, vitest_1.expect)((0, api_paths_1.resolveAdminSectionFromApiPath)('/api/v1/catalog/admin/media/objects')).toBe('objects');
        (0, vitest_1.expect)((0, api_paths_1.resolveAdminSectionFromApiPath)('/api/v1/users/admin/partner-applications')).toBe('applications');
        (0, vitest_1.expect)((0, api_paths_1.resolveAdminSectionFromApiPath)('/api/v1/settings/admin/staff')).toBe('staff');
    });
    (0, vitest_1.it)('maps pathnames and access', () => {
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/orders/sourcing/abc')).toBe('orders');
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/orders', ['clients'], false)).toBe(false);
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin', ['clients'], false)).toBe(true);
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/settings/staff', [], true)).toBe(true);
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/settings/staff/me', ['clients'], false)).toBe(true);
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/login', [], false)).toBe(true);
    });
    (0, vitest_1.it)('denies unknown admin pathnames for moderator (deny-by-default)', () => {
        (0, vitest_1.expect)((0, pathnames_1.resolveAdminSectionFromPathname)('/admin/foo')).toBeNull();
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/foo', ['orders', 'clients'], false)).toBe(false);
        (0, vitest_1.expect)((0, pathnames_1.staffCanAccessAdminPath)('/admin/foo', [], true)).toBe(true);
    });
});
