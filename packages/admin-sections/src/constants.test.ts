import { describe, expect, it } from 'vitest';
import { resolveAdminSectionFromApiPath } from './api-paths';
import { normalizeStoredAdminSections } from './constants';
import { resolveAdminSectionFromPathname, staffCanAccessAdminPath } from './pathnames';

describe('admin-sections', () => {
  it('normalizes stored section ids without dashboard', () => {
    expect(normalizeStoredAdminSections(['orders', 'bogus', 'orders'])).toEqual(['orders']);
    expect(normalizeStoredAdminSections(['dashboard', 'orders'])).toEqual(['orders']);
  });

  it('maps api paths', () => {
    expect(resolveAdminSectionFromApiPath('/api/v1/catalog/admin/products')).toBe('catalog');
    expect(resolveAdminSectionFromApiPath('/api/v1/catalog/admin/brands/x')).toBe('brands');
    expect(resolveAdminSectionFromApiPath('/api/v1/catalog/admin/media/objects')).toBe('objects');
    expect(resolveAdminSectionFromApiPath('/api/v1/users/admin/partner-applications')).toBe(
      'applications',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff')).toBe('staff');
  });

  it('maps pathnames and access', () => {
    expect(resolveAdminSectionFromPathname('/admin/orders/sourcing/abc')).toBe('orders');
    expect(staffCanAccessAdminPath('/admin/orders', ['clients'], false)).toBe(false);
    expect(staffCanAccessAdminPath('/admin', ['clients'], false)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/settings/staff', [], true)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/settings/staff/me', ['clients'], false)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/login', [], false)).toBe(true);
  });

  it('denies unknown admin pathnames for moderator (deny-by-default)', () => {
    expect(resolveAdminSectionFromPathname('/admin/foo')).toBeNull();
    expect(staffCanAccessAdminPath('/admin/foo', ['orders', 'clients'], false)).toBe(false);
    expect(staffCanAccessAdminPath('/admin/foo', [], true)).toBe(true);
  });
});
