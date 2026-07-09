import { normalizeStoredAdminSections, type AdminSectionId, type ModeratorAssignableSectionId } from '@win-win/admin-sections';
import { UserRole } from '@prisma/client';

export const STAFF_DELETED_EMAIL_PREFIX = 'staff-deleted-';

export function staffDeletedEmail(userId: string): string {
  return `${STAFF_DELETED_EMAIL_PREFIX}${userId}@invalid.local`;
}

export function isStaffDeletedEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.startsWith(STAFF_DELETED_EMAIL_PREFIX);
}

export type StaffContext = {
  isSuperAdmin: boolean;
  sections: AdminSectionId[];
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
};

export type StaffAccessSnapshot = {
  role: UserRole;
  isActive: boolean;
  adminSections: string[];
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
};

export type StaffAdminRow = {
  id: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
  adminSections: ModeratorAssignableSectionId[];
  lastAdminLoginAt: string | null;
  createdAt: string;
};

export function rowFromUser(u: {
  id: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
  adminSections: string[];
  lastAdminLoginAt: Date | null;
  createdAt: Date;
}): StaffAdminRow {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    staffDisplayName: u.staffDisplayName,
    staffAvatarUrl: u.staffAvatarUrl,
    adminSections: normalizeStoredAdminSections(u.adminSections),
    lastAdminLoginAt: u.lastAdminLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export const staffUserSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  staffDisplayName: true,
  staffAvatarUrl: true,
  adminSections: true,
  lastAdminLoginAt: true,
  createdAt: true,
} as const;
