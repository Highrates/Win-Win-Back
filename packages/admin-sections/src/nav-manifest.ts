import type { AdminSectionId } from './constants';

/** Раздел или pseudo-раздел «staff» (только суперадмин). */
export type AdminNavAccessSection = AdminSectionId | 'staff';

export type AdminNavLabelKey =
  | AdminSectionId
  | 'products'
  | 'categories'
  | 'collections'
  | 'contextTags'
  | 'productSets'
  | 'pricing'
  | 'staff'
  | 'userGroups'
  | 'referrals'
  | 'site';

export type AdminNavChild = {
  href: string;
  labelKey: AdminNavLabelKey;
  section?: AdminNavAccessSection;
  /** Спец-логика подсветки активного пункта в сайдбаре. */
  activeMatch?: 'collections' | 'contextTags' | 'productSets' | 'referrals' | 'userGroups';
};

export type AdminNavGroup = {
  section: AdminNavAccessSection;
  labelKey: AdminNavLabelKey;
  children: readonly AdminNavChild[];
};

export type AdminNavMidLink = {
  href: string;
  section: AdminSectionId;
  labelKey: AdminNavLabelKey;
};

export type AdminDashboardLinkKey =
  | 'catalog'
  | 'brands'
  | 'orders'
  | 'clients'
  | 'blog'
  | 'referrals'
  | 'collections'
  | 'productSets';

export type AdminDashboardLink = {
  href: string;
  section: AdminSectionId;
  key: AdminDashboardLinkKey;
  labelKey: AdminNavLabelKey;
};

/** Единый конфиг сайдбара админки. */
export const ADMIN_NAV_MANIFEST = {
  dashboard: {
    href: '/admin',
    section: 'dashboard' as const,
    labelKey: 'dashboard' as const,
  },
  catalog: {
    section: 'catalog' as const,
    labelKey: 'catalog' as const,
    children: [
      { href: '/admin/catalog/products', labelKey: 'products' as const },
      { href: '/admin/catalog/categories', labelKey: 'categories' as const },
      {
        href: '/admin/catalog/tags',
        labelKey: 'contextTags' as const,
        activeMatch: 'contextTags' as const,
      },
      {
        href: '/admin/collections',
        labelKey: 'collections' as const,
        activeMatch: 'collections' as const,
      },
      {
        href: '/admin/product-sets',
        labelKey: 'productSets' as const,
        activeMatch: 'productSets' as const,
      },
    ] satisfies readonly AdminNavChild[],
  },
  midLinks: [
    { href: '/admin/brands', section: 'brands', labelKey: 'brands' },
    { href: '/admin/blog', section: 'blog', labelKey: 'blog' },
    { href: '/admin/orders', section: 'orders', labelKey: 'orders' },
    { href: '/admin/applications', section: 'applications', labelKey: 'applications' },
    { href: '/admin/clients', section: 'clients', labelKey: 'clients' },
    { href: '/admin/objects', section: 'objects', labelKey: 'objects' },
    { href: '/admin/journal', section: 'journal', labelKey: 'journal' },
  ] satisfies readonly AdminNavMidLink[],
  settings: {
    section: 'settings' as const,
    labelKey: 'settings' as const,
    children: [
      { href: '/admin/settings/pricing', labelKey: 'pricing', section: 'settings' },
      { href: '/admin/settings/staff', labelKey: 'staff', section: 'staff' },
      {
        href: '/admin/user-groups',
        labelKey: 'userGroups',
        section: 'settings',
        activeMatch: 'userGroups',
      },
      {
        href: '/admin/referrals',
        labelKey: 'referrals',
        section: 'settings',
        activeMatch: 'referrals',
      },
      { href: '/admin/settings/site', labelKey: 'site', section: 'settings' },
    ] satisfies readonly AdminNavChild[],
  },
} as const;

/** @deprecated Используйте ADMIN_NAV_MANIFEST.midLinks */
export const ADMIN_NAV_MID_LINKS: readonly AdminNavMidLink[] = ADMIN_NAV_MANIFEST.midLinks;

/** @deprecated Используйте ADMIN_NAV_MANIFEST.catalog.children */
export const ADMIN_NAV_CATALOG_CHILDREN = ADMIN_NAV_MANIFEST.catalog.children;

/** @deprecated Используйте ADMIN_NAV_MANIFEST.settings.children */
export const ADMIN_NAV_SETTINGS_CHILDREN: readonly AdminNavChild[] =
  ADMIN_NAV_MANIFEST.settings.children;

/** Карточки на /admin — section для фильтрации по правам. */
export const ADMIN_DASHBOARD_LINKS: readonly AdminDashboardLink[] = [
  { href: '/admin/catalog', section: 'catalog', key: 'catalog', labelKey: 'catalog' },
  { href: '/admin/brands', section: 'brands', key: 'brands', labelKey: 'brands' },
  { href: '/admin/orders', section: 'orders', key: 'orders', labelKey: 'orders' },
  { href: '/admin/clients', section: 'clients', key: 'clients', labelKey: 'clients' },
  { href: '/admin/blog', section: 'blog', key: 'blog', labelKey: 'blog' },
  { href: '/admin/referrals', section: 'settings', key: 'referrals', labelKey: 'referrals' },
  { href: '/admin/collections', section: 'catalog', key: 'collections', labelKey: 'collections' },
  { href: '/admin/product-sets', section: 'catalog', key: 'productSets', labelKey: 'productSets' },
];

/** Страницы вне manifest, но с известным разделом (для route guard). */
export const ADMIN_EXTRA_PATH_PREFIXES: readonly {
  prefix: string;
  section: AdminNavAccessSection;
}[] = [
  { prefix: '/admin/modeling', section: 'catalog' },
  { prefix: '/admin/designer-projects', section: 'clients' },
  { prefix: '/admin/pages', section: 'settings' },
];

export const ADMIN_NAV_CATALOG_PATH_PREFIXES = [
  '/admin/catalog',
  '/admin/collections',
  '/admin/product-sets',
] as const;

export const ADMIN_NAV_SETTINGS_PATH_PREFIXES = [
  '/admin/settings',
  '/admin/referrals',
  '/admin/user-groups',
] as const;

export function isAdminNavCatalogPath(pathname: string): boolean {
  return ADMIN_NAV_CATALOG_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isAdminNavSettingsPath(pathname: string): boolean {
  return ADMIN_NAV_SETTINGS_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isAdminNavChildActive(pathname: string, child: AdminNavChild): boolean {
  if (child.activeMatch === 'collections') return pathname.startsWith('/admin/collections');
  if (child.activeMatch === 'contextTags') return pathname.startsWith('/admin/catalog/tags');
  if (child.activeMatch === 'productSets') return pathname.startsWith('/admin/product-sets');
  if (child.activeMatch === 'referrals') return pathname.startsWith('/admin/referrals');
  if (child.activeMatch === 'userGroups') return pathname.startsWith('/admin/user-groups');
  return pathname === child.href || pathname.startsWith(`${child.href}/`);
}

/** Все href из manifest + dashboard cards (для CI и pathnames). */
export function collectAdminNavHrefs(): string[] {
  const hrefs = new Set<string>();
  hrefs.add(ADMIN_NAV_MANIFEST.dashboard.href);
  for (const child of ADMIN_NAV_MANIFEST.catalog.children) hrefs.add(child.href);
  for (const link of ADMIN_NAV_MANIFEST.midLinks) hrefs.add(link.href);
  for (const child of ADMIN_NAV_MANIFEST.settings.children) hrefs.add(child.href);
  for (const link of ADMIN_DASHBOARD_LINKS) hrefs.add(link.href);
  return Array.from(hrefs);
}

export type AdminPathPrefixRule = {
  prefix: string;
  section: AdminNavAccessSection;
};

/** Префиксы pathname → раздел; длинные совпадения проверяются первыми. */
export function collectAdminPathPrefixRules(): AdminPathPrefixRule[] {
  const rules: AdminPathPrefixRule[] = [];

  for (const child of ADMIN_NAV_MANIFEST.settings.children) {
    rules.push({
      prefix: child.href,
      section: child.section ?? ADMIN_NAV_MANIFEST.settings.section,
    });
  }
  for (const link of ADMIN_NAV_MANIFEST.midLinks) {
    rules.push({ prefix: link.href, section: link.section });
  }
  for (const child of ADMIN_NAV_MANIFEST.catalog.children) {
    rules.push({ prefix: child.href, section: 'catalog' });
  }
  rules.push({ prefix: '/admin/catalog', section: 'catalog' });
  rules.push({ prefix: '/admin/settings', section: 'settings' });
  for (const extra of ADMIN_EXTRA_PATH_PREFIXES) {
    rules.push(extra);
  }

  const seen = new Set<string>();
  return rules
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .filter((rule) => {
      if (seen.has(rule.prefix)) return false;
      seen.add(rule.prefix);
      return true;
    });
}
