import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ALL_MODERATOR_SECTIONS_WITH_DASHBOARD,
  ADMIN_SECTION_DASHBOARD,
  normalizeStoredAdminSections,
  resolveAdminSectionFromApiPath,
  type AdminSectionId,
} from '@win-win/admin-sections';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { StaffAccessSnapshot, StaffContext } from './staff.types';

@Injectable()
export class StaffAccessService {
  private static readonly ACCESS_CACHE_TTL_MS = 30_000;

  private readonly accessCache = new Map<
    string,
    { at: number; data: StaffAccessSnapshot }
  >();

  constructor(private readonly prisma: PrismaService) {}

  invalidateStaffAccessCache(userId: string): void {
    this.accessCache.delete(userId);
  }

  isSuperAdmin(role: string): boolean {
    return role === UserRole.ADMIN;
  }

  effectiveSections(
    role: UserRole,
    adminSections: readonly string[],
  ): AdminSectionId[] {
    if (role === UserRole.ADMIN) {
      return [...ALL_MODERATOR_SECTIONS_WITH_DASHBOARD];
    }
    if (role === UserRole.MODERATOR) {
      return [ADMIN_SECTION_DASHBOARD, ...normalizeStoredAdminSections(adminSections)];
    }
    return [];
  }

  /** Убирает staff-поля из публичного user — клиенты используют только `staff`. */
  stripStaffFieldsFromPublicUser<T extends Record<string, unknown>>(user: T) {
    const {
      adminSections: _adminSections,
      staffDisplayName: _staffDisplayName,
      staffAvatarUrl: _staffAvatarUrl,
      lastAdminLoginAt: _lastAdminLoginAt,
      ...publicUser
    } = user;
    return publicUser;
  }

  private async loadStaffAccessSnapshot(userId: string): Promise<StaffAccessSnapshot | null> {
    const now = Date.now();
    const cached = this.accessCache.get(userId);
    if (cached && now - cached.at < StaffAccessService.ACCESS_CACHE_TTL_MS) {
      return cached.data;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        isActive: true,
        adminSections: true,
        staffDisplayName: true,
        staffAvatarUrl: true,
      },
    });
    if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.MODERATOR)) {
      return null;
    }

    const data: StaffAccessSnapshot = {
      role: user.role,
      isActive: user.isActive,
      adminSections: user.adminSections,
      staffDisplayName: user.staffDisplayName,
      staffAvatarUrl: user.staffAvatarUrl,
    };
    this.accessCache.set(userId, { at: now, data });
    return data;
  }

  async getStaffContext(userId: string, role: UserRole): Promise<StaffContext | null> {
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) return null;
    const snapshot = await this.loadStaffAccessSnapshot(userId);
    if (!snapshot?.isActive) return null;
    return {
      isSuperAdmin: snapshot.role === UserRole.ADMIN,
      sections: this.effectiveSections(snapshot.role, snapshot.adminSections),
      staffDisplayName: snapshot.staffDisplayName,
      staffAvatarUrl: snapshot.staffAvatarUrl,
    };
  }

  async canAccessApiPath(userId: string, role: string, pathOnly: string): Promise<boolean> {
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) return false;

    const target = resolveAdminSectionFromApiPath(pathOnly);
    if (target == null) return false;
    if (target === 'staff') return role === UserRole.ADMIN;

    const snapshot = await this.loadStaffAccessSnapshot(userId);
    if (!snapshot?.isActive) return false;
    if (role === UserRole.ADMIN) return snapshot.role === UserRole.ADMIN;

    const sections = this.effectiveSections(UserRole.MODERATOR, snapshot.adminSections);
    return sections.includes(target);
  }

  async isStaffAccountActive(userId: string): Promise<boolean> {
    const snapshot = await this.loadStaffAccessSnapshot(userId);
    if (!snapshot) return false;
    return snapshot.isActive;
  }

  async canAccessSection(userId: string, role: UserRole, section: AdminSectionId): Promise<boolean> {
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) return false;
    const snapshot = await this.loadStaffAccessSnapshot(userId);
    if (!snapshot?.isActive) return false;
    if (role === UserRole.ADMIN) return true;

    const sections = this.effectiveSections(UserRole.MODERATOR, snapshot.adminSections);
    return sections.includes(section);
  }

  async assertStaffCanAccessSection(
    userId: string,
    role: UserRole,
    section: AdminSectionId,
  ): Promise<void> {
    const allowed = await this.canAccessSection(userId, role, section);
    if (!allowed) {
      throw new ForbiddenException('Нет доступа к этому разделу админки');
    }
  }

  async canAccessOrdersSection(userId: string, role: UserRole): Promise<boolean> {
    return this.canAccessSection(userId, role, 'orders');
  }

  async listOrderNotifyStaffEmails(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        email: { not: null },
        OR: [
          { role: UserRole.ADMIN },
          {
            role: UserRole.MODERATOR,
            adminSections: { has: 'orders' },
          },
        ],
      },
      select: { email: true },
    });
    return [...new Set(rows.map((r) => r.email!.trim()).filter(Boolean))];
  }
}
