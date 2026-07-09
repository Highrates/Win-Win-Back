import type { AdminSectionId } from './constants';
export type AdminApiAccessTarget = AdminSectionId | 'staff';
/** Nest API path (без query), напр. `/api/v1/catalog/admin/products`. */
export declare function resolveAdminSectionFromApiPath(pathOnly: string): AdminApiAccessTarget | null;
