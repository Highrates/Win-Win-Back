import type { AdminSectionId } from './constants';
import type { AdminNavLabelKey } from './nav-manifest';
export declare function adminSectionLabel(id: AdminSectionId, locale?: 'ru' | 'zh'): string;
export declare function adminNavLabel(labelKey: AdminNavLabelKey, locale?: 'ru' | 'zh'): string;
export declare function adminSectionCatalog(locale?: 'ru' | 'zh'): Array<{
    id: AdminSectionId;
    label: string;
}>;
