import type { AdminSectionId } from './constants';
/** Раздел или pseudo-раздел «staff» (только суперадмин). */
export type AdminNavAccessSection = AdminSectionId | 'staff';
export type AdminNavLabelKey = AdminSectionId | 'products' | 'categories' | 'collections' | 'contextTags' | 'productSets' | 'pricing' | 'staff' | 'userGroups' | 'referrals' | 'site';
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
export type AdminDashboardLinkKey = 'catalog' | 'brands' | 'orders' | 'clients' | 'blog' | 'referrals' | 'collections' | 'productSets';
export type AdminDashboardLink = {
    href: string;
    section: AdminSectionId;
    key: AdminDashboardLinkKey;
    labelKey: AdminNavLabelKey;
};
/** Единый конфиг сайдбара админки. */
export declare const ADMIN_NAV_MANIFEST: {
    readonly dashboard: {
        readonly href: "/admin";
        readonly section: "dashboard";
        readonly labelKey: "dashboard";
    };
    readonly catalog: {
        readonly section: "catalog";
        readonly labelKey: "catalog";
        readonly children: ({
            href: string;
            labelKey: "products";
            activeMatch?: undefined;
        } | {
            href: string;
            labelKey: "categories";
            activeMatch?: undefined;
        } | {
            href: string;
            labelKey: "contextTags";
            activeMatch: "contextTags";
        } | {
            href: string;
            labelKey: "collections";
            activeMatch: "collections";
        } | {
            href: string;
            labelKey: "productSets";
            activeMatch: "productSets";
        })[];
    };
    readonly midLinks: ({
        href: string;
        section: "brands";
        labelKey: "brands";
    } | {
        href: string;
        section: "blog";
        labelKey: "blog";
    } | {
        href: string;
        section: "orders";
        labelKey: "orders";
    } | {
        href: string;
        section: "applications";
        labelKey: "applications";
    } | {
        href: string;
        section: "clients";
        labelKey: "clients";
    } | {
        href: string;
        section: "objects";
        labelKey: "objects";
    } | {
        href: string;
        section: "journal";
        labelKey: "journal";
    })[];
    readonly settings: {
        readonly section: "settings";
        readonly labelKey: "settings";
        readonly children: ({
            href: string;
            labelKey: "pricing";
            section: "settings";
            activeMatch?: undefined;
        } | {
            href: string;
            labelKey: "staff";
            section: "staff";
            activeMatch?: undefined;
        } | {
            href: string;
            labelKey: "userGroups";
            section: "settings";
            activeMatch: "userGroups";
        } | {
            href: string;
            labelKey: "referrals";
            section: "settings";
            activeMatch: "referrals";
        } | {
            href: string;
            labelKey: "site";
            section: "settings";
            activeMatch?: undefined;
        })[];
    };
};
/** @deprecated Используйте ADMIN_NAV_MANIFEST.midLinks */
export declare const ADMIN_NAV_MID_LINKS: readonly AdminNavMidLink[];
/** @deprecated Используйте ADMIN_NAV_MANIFEST.catalog.children */
export declare const ADMIN_NAV_CATALOG_CHILDREN: ({
    href: string;
    labelKey: "products";
    activeMatch?: undefined;
} | {
    href: string;
    labelKey: "categories";
    activeMatch?: undefined;
} | {
    href: string;
    labelKey: "contextTags";
    activeMatch: "contextTags";
} | {
    href: string;
    labelKey: "collections";
    activeMatch: "collections";
} | {
    href: string;
    labelKey: "productSets";
    activeMatch: "productSets";
})[];
/** @deprecated Используйте ADMIN_NAV_MANIFEST.settings.children */
export declare const ADMIN_NAV_SETTINGS_CHILDREN: readonly AdminNavChild[];
/** Карточки на /admin — section для фильтрации по правам. */
export declare const ADMIN_DASHBOARD_LINKS: readonly AdminDashboardLink[];
/** Страницы вне manifest, но с известным разделом (для route guard). */
export declare const ADMIN_EXTRA_PATH_PREFIXES: readonly {
    prefix: string;
    section: AdminNavAccessSection;
}[];
export declare const ADMIN_NAV_CATALOG_PATH_PREFIXES: readonly ["/admin/catalog", "/admin/collections", "/admin/product-sets"];
export declare const ADMIN_NAV_SETTINGS_PATH_PREFIXES: readonly ["/admin/settings", "/admin/referrals", "/admin/user-groups"];
export declare function isAdminNavCatalogPath(pathname: string): boolean;
export declare function isAdminNavSettingsPath(pathname: string): boolean;
export declare function isAdminNavChildActive(pathname: string, child: AdminNavChild): boolean;
/** Все href из manifest + dashboard cards (для CI и pathnames). */
export declare function collectAdminNavHrefs(): string[];
export type AdminPathPrefixRule = {
    prefix: string;
    section: AdminNavAccessSection;
};
/** Префиксы pathname → раздел; длинные совпадения проверяются первыми. */
export declare function collectAdminPathPrefixRules(): AdminPathPrefixRule[];
