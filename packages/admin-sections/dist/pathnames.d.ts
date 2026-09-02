import { type AdminSectionId } from './constants';
export type AdminPathAccessTarget = AdminSectionId | 'staff';
/** Next.js pathname админки, напр. `/admin/orders/sourcing/abc`. */
export declare function resolveAdminSectionFromPathname(pathname: string): AdminPathAccessTarget | null;
export declare function staffCanAccessAdminPath(pathname: string, sections: readonly AdminSectionId[], isSuperAdmin: boolean): boolean;
/** Суперадмин или явный grant `assistant` (FAB + API). */
export declare function staffCanAssistant(sections: readonly string[], isSuperAdmin: boolean): boolean;
