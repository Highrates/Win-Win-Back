import type { AdminSectionId } from './constants';

export type AdminApiAccessTarget = AdminSectionId | 'staff';

/** Nest API path (без query), напр. `/api/v1/catalog/admin/products`. */
export function resolveAdminSectionFromApiPath(pathOnly: string): AdminApiAccessTarget | null {
  const p = pathOnly.split('?')[0].replace(/\/+$/, '');

  if (p.includes('/settings/admin/staff/me')) return 'dashboard';
  if (p.includes('/settings/admin/staff')) return 'staff';

  if (p.includes('/users/admin/partner-applications')) return 'applications';
  if (p.includes('/users/admin')) return 'clients';

  if (p.includes('/cases/admin/')) return 'clients';
  if (p.includes('/designer-projects/admin')) return 'clients';

  if (p.includes('/sourcing-requests/admin')) return 'orders';
  if (p.includes('/orders/admin')) return 'orders';

  if (p.includes('/audit/admin')) return 'journal';

  if (p.includes('/blog/admin')) return 'blog';

  if (p.includes('/catalog/admin/media')) return 'objects';

  if (p.includes('/catalog/admin/brands')) return 'brands';

  if (p.includes('/catalog/admin/pricing-profiles')) return 'settings';

  if (p.includes('/settings/admin/')) return 'settings';
  if (p.includes('/referrals/admin')) return 'settings';

  if (p.includes('/catalog/admin')) return 'catalog';

  return null;
}
