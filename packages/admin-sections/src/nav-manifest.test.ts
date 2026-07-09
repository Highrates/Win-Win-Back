import { describe, expect, it } from 'vitest';
import { collectAdminNavHrefs } from './nav-manifest';
import { resolveAdminSectionFromPathname } from './pathnames';

describe('nav manifest pathnames', () => {
  it('resolves every manifest href to a section', () => {
    const hrefs = collectAdminNavHrefs();
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      const section = resolveAdminSectionFromPathname(href);
      expect(section, `href ${href} must resolve`).not.toBeNull();
    }
  });

  it('resolves nested admin paths under manifest hrefs', () => {
    expect(resolveAdminSectionFromPathname('/admin/orders/sourcing/abc')).toBe('orders');
    expect(resolveAdminSectionFromPathname('/admin/catalog/products/new')).toBe('catalog');
    expect(resolveAdminSectionFromPathname('/admin/settings/staff/me')).toBe('dashboard');
    expect(resolveAdminSectionFromPathname('/admin/settings/staff')).toBe('staff');
    expect(resolveAdminSectionFromPathname('/admin/modeling')).toBe('catalog');
    expect(resolveAdminSectionFromPathname('/admin/designer-projects/abc')).toBe('clients');
  });
});
