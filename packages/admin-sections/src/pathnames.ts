import { ADMIN_SECTION_DASHBOARD, type AdminSectionId } from './constants';
import { collectAdminPathPrefixRules } from './nav-manifest';

export type AdminPathAccessTarget = AdminSectionId | 'staff';

/** Next.js pathname админки, напр. `/admin/orders/sourcing/abc`. */
export function resolveAdminSectionFromPathname(pathname: string): AdminPathAccessTarget | null {
  const p = pathname.replace(/\/+$/, '') || '/';

  if (p === '/admin/login') return null;

  if (p === '/admin/settings/staff/me') return ADMIN_SECTION_DASHBOARD;

  if (p === '/admin') return ADMIN_SECTION_DASHBOARD;

  if (p === '/admin/settings/staff' || p.startsWith('/admin/settings/staff/')) {
    return 'staff';
  }

  for (const rule of collectAdminPathPrefixRules()) {
    if (p === rule.prefix || p.startsWith(`${rule.prefix}/`)) {
      return rule.section;
    }
  }

  return null;
}

export function staffCanAccessAdminPath(
  pathname: string,
  sections: readonly AdminSectionId[],
  isSuperAdmin: boolean,
): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/admin/login') return true;

  if (isSuperAdmin) return true;

  const target = resolveAdminSectionFromPathname(pathname);
  if (target == null) return false;
  if (target === 'staff') return false;
  if (target === ADMIN_SECTION_DASHBOARD) return true;
  return sections.includes(target);
}
