"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_NAV_SETTINGS_PATH_PREFIXES = exports.ADMIN_NAV_CATALOG_PATH_PREFIXES = exports.ADMIN_EXTRA_PATH_PREFIXES = exports.ADMIN_DASHBOARD_LINKS = exports.ADMIN_NAV_SETTINGS_CHILDREN = exports.ADMIN_NAV_CATALOG_CHILDREN = exports.ADMIN_NAV_MID_LINKS = exports.ADMIN_NAV_MANIFEST = void 0;
exports.isAdminNavCatalogPath = isAdminNavCatalogPath;
exports.isAdminNavSettingsPath = isAdminNavSettingsPath;
exports.isAdminNavChildActive = isAdminNavChildActive;
exports.collectAdminNavHrefs = collectAdminNavHrefs;
exports.collectAdminPathPrefixRules = collectAdminPathPrefixRules;
/** Единый конфиг сайдбара админки. */
exports.ADMIN_NAV_MANIFEST = {
    dashboard: {
        href: '/admin',
        section: 'dashboard',
        labelKey: 'dashboard',
    },
    catalog: {
        section: 'catalog',
        labelKey: 'catalog',
        children: [
            { href: '/admin/catalog/products', labelKey: 'products' },
            { href: '/admin/catalog/categories', labelKey: 'categories' },
            {
                href: '/admin/collections',
                labelKey: 'collections',
                activeMatch: 'collections',
            },
            {
                href: '/admin/product-sets',
                labelKey: 'productSets',
                activeMatch: 'productSets',
            },
        ],
    },
    midLinks: [
        { href: '/admin/brands', section: 'brands', labelKey: 'brands' },
        { href: '/admin/blog', section: 'blog', labelKey: 'blog' },
        { href: '/admin/orders', section: 'orders', labelKey: 'orders' },
        { href: '/admin/applications', section: 'applications', labelKey: 'applications' },
        { href: '/admin/clients', section: 'clients', labelKey: 'clients' },
        { href: '/admin/objects', section: 'objects', labelKey: 'objects' },
        { href: '/admin/journal', section: 'journal', labelKey: 'journal' },
    ],
    settings: {
        section: 'settings',
        labelKey: 'settings',
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
        ],
    },
};
/** @deprecated Используйте ADMIN_NAV_MANIFEST.midLinks */
exports.ADMIN_NAV_MID_LINKS = exports.ADMIN_NAV_MANIFEST.midLinks;
/** @deprecated Используйте ADMIN_NAV_MANIFEST.catalog.children */
exports.ADMIN_NAV_CATALOG_CHILDREN = exports.ADMIN_NAV_MANIFEST.catalog.children;
/** @deprecated Используйте ADMIN_NAV_MANIFEST.settings.children */
exports.ADMIN_NAV_SETTINGS_CHILDREN = exports.ADMIN_NAV_MANIFEST.settings.children;
/** Карточки на /admin — section для фильтрации по правам. */
exports.ADMIN_DASHBOARD_LINKS = [
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
exports.ADMIN_EXTRA_PATH_PREFIXES = [
    { prefix: '/admin/modeling', section: 'catalog' },
    { prefix: '/admin/designer-projects', section: 'clients' },
    { prefix: '/admin/pages', section: 'settings' },
];
exports.ADMIN_NAV_CATALOG_PATH_PREFIXES = [
    '/admin/catalog',
    '/admin/collections',
    '/admin/product-sets',
];
exports.ADMIN_NAV_SETTINGS_PATH_PREFIXES = [
    '/admin/settings',
    '/admin/referrals',
    '/admin/user-groups',
];
function isAdminNavCatalogPath(pathname) {
    return exports.ADMIN_NAV_CATALOG_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}
function isAdminNavSettingsPath(pathname) {
    return exports.ADMIN_NAV_SETTINGS_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}
function isAdminNavChildActive(pathname, child) {
    if (child.activeMatch === 'collections')
        return pathname.startsWith('/admin/collections');
    if (child.activeMatch === 'productSets')
        return pathname.startsWith('/admin/product-sets');
    if (child.activeMatch === 'referrals')
        return pathname.startsWith('/admin/referrals');
    if (child.activeMatch === 'userGroups')
        return pathname.startsWith('/admin/user-groups');
    return pathname === child.href || pathname.startsWith(`${child.href}/`);
}
/** Все href из manifest + dashboard cards (для CI и pathnames). */
function collectAdminNavHrefs() {
    const hrefs = new Set();
    hrefs.add(exports.ADMIN_NAV_MANIFEST.dashboard.href);
    for (const child of exports.ADMIN_NAV_MANIFEST.catalog.children)
        hrefs.add(child.href);
    for (const link of exports.ADMIN_NAV_MANIFEST.midLinks)
        hrefs.add(link.href);
    for (const child of exports.ADMIN_NAV_MANIFEST.settings.children)
        hrefs.add(child.href);
    for (const link of exports.ADMIN_DASHBOARD_LINKS)
        hrefs.add(link.href);
    return [...hrefs];
}
/** Префиксы pathname → раздел; длинные совпадения проверяются первыми. */
function collectAdminPathPrefixRules() {
    const rules = [];
    for (const child of exports.ADMIN_NAV_MANIFEST.settings.children) {
        rules.push({
            prefix: child.href,
            section: child.section ?? exports.ADMIN_NAV_MANIFEST.settings.section,
        });
    }
    for (const link of exports.ADMIN_NAV_MANIFEST.midLinks) {
        rules.push({ prefix: link.href, section: link.section });
    }
    for (const child of exports.ADMIN_NAV_MANIFEST.catalog.children) {
        rules.push({ prefix: child.href, section: 'catalog' });
    }
    rules.push({ prefix: '/admin/catalog', section: 'catalog' });
    rules.push({ prefix: '/admin/settings', section: 'settings' });
    for (const extra of exports.ADMIN_EXTRA_PATH_PREFIXES) {
        rules.push(extra);
    }
    const seen = new Set();
    return rules
        .sort((a, b) => b.prefix.length - a.prefix.length)
        .filter((rule) => {
        if (seen.has(rule.prefix))
            return false;
        seen.add(rule.prefix);
        return true;
    });
}
