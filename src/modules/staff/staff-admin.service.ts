import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MODERATOR_ASSIGNABLE_SECTIONS,
  adminSectionCatalog,
  normalizeStoredAdminSections,
  type ModeratorAssignableSectionId,
} from '@win-win/admin-sections';
import { AuditAction, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../auth/mail.service';
import { UsersService } from '../users/users.service';
import { StaffAccessService } from './staff-access.service';
import { generateStaffPassword } from './staff-password.util';
import { rowFromUser, staffUserSelect, type StaffAdminRow } from './staff.types';

export type { StaffAdminRow, StaffContext } from './staff.types';

@Injectable()
export class StaffAdminService {
  private readonly logger = new Logger(StaffAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly staffAccess: StaffAccessService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  listSectionCatalog(locale: 'ru' | 'zh') {
    return {
      assignable: MODERATOR_ASSIGNABLE_SECTIONS.map((id) => ({
        id,
        label: adminSectionCatalog(locale).find((r) => r.id === id)?.label ?? id,
      })),
    };
  }

  async listStaff(): Promise<StaffAdminRow[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.MODERATOR] } },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      select: staffUserSelect,
    });
    return rows.map(rowFromUser);
  }

  async getStaffSelf(userId: string): Promise<StaffAdminRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: staffUserSelect,
    });
    if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.MODERATOR)) {
      throw new NotFoundException('Сотрудник не найден');
    }
    return rowFromUser(user);
  }

  async updateStaffSelf(
    userId: string,
    dto: { staffDisplayName?: string | null },
  ): Promise<StaffAdminRow> {
    return this.updateStaff(userId, userId, dto, { self: true });
  }

  async uploadStaffAvatar(
    actorUserId: string,
    targetUserId: string,
    file: Express.Multer.File,
  ): Promise<StaffAdminRow> {
    if (!file) throw new BadRequestException('Файл не передан');

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target || (target.role !== UserRole.ADMIN && target.role !== UserRole.MODERATOR)) {
      throw new NotFoundException('Сотрудник не найден');
    }

    if (actorUserId !== targetUserId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { role: true },
      });
      if (actor?.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Только суперадмин может менять аватар другого сотрудника');
      }
    }

    const { publicUrl } = await this.users.uploadUserAvatarImage(targetUserId, file);
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { staffAvatarUrl: publicUrl },
      select: staffUserSelect,
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'StaffUser',
      entityId: targetUserId,
      path:
        actorUserId === targetUserId
          ? '/settings/admin/staff/me/avatar'
          : `/settings/admin/staff/${targetUserId}/avatar`,
      actorUserId,
      metadata: { kind: 'staff_avatar_upload' },
    });

    this.staffAccess.invalidateStaffAccessCache(targetUserId);
    return rowFromUser(updated);
  }

  async createStaff(
    actorUserId: string,
    dto: {
      email: string;
      staffDisplayName?: string;
      adminSections: ModeratorAssignableSectionId[];
    },
  ): Promise<{ user: StaffAdminRow; emailSent: boolean }> {
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email обязателен');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === UserRole.ADMIN || existing.role === UserRole.MODERATOR) {
        throw new BadRequestException('Сотрудник с таким email уже существует');
      }
      throw new BadRequestException(
        'Email уже используется клиентским аккаунтом. Укажите другой адрес.',
      );
    }

    const sections = this.ensureNonEmptyAssignableSections(dto.adminSections);
    const password = generateStaffPassword();
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.MODERATOR,
        isActive: true,
        staffDisplayName: dto.staffDisplayName?.trim() || null,
        adminSections: sections,
        profile: { create: {} },
      },
      select: staffUserSelect,
    });

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: 'StaffUser',
      entityId: user.id,
      path: '/settings/admin/staff',
      actorUserId,
      metadata: {
        kind: 'staff_created',
        email,
        adminSections: sections,
      },
    });

    let emailSent = false;
    try {
      await this.mail.sendStaffAdminWelcome({
        to: email,
        password,
        loginUrl: this.resolveAdminLoginUrl(),
        staffDisplayName: user.staffDisplayName,
      });
      emailSent = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Staff welcome email failed for ${email}: ${msg}`);
    }

    return { user: rowFromUser(user), emailSent };
  }

  async updateStaff(
    actorUserId: string,
    id: string,
    dto: {
      staffDisplayName?: string | null;
      adminSections?: ModeratorAssignableSectionId[];
      isActive?: boolean;
    },
    opts?: { self?: boolean },
  ): Promise<StaffAdminRow> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: staffUserSelect,
    });
    if (!current || (current.role !== UserRole.ADMIN && current.role !== UserRole.MODERATOR)) {
      throw new NotFoundException('Сотрудник не найден');
    }

    if (opts?.self) {
      if (actorUserId !== id) {
        throw new ForbiddenException('Можно редактировать только свой профиль');
      }
      if (dto.adminSections !== undefined || dto.isActive !== undefined) {
        throw new BadRequestException('Недоступно для самостоятельного редактирования');
      }
    }

    if (dto.isActive === false && current.role === UserRole.ADMIN) {
      await this.assertCanDeactivateAdmin(current.id);
    }

    const data: {
      staffDisplayName?: string | null;
      adminSections?: string[];
      isActive?: boolean;
    } = {};

    if (dto.staffDisplayName !== undefined) {
      data.staffDisplayName = dto.staffDisplayName?.trim() || null;
    }
    if (dto.adminSections !== undefined) {
      if (current.role === UserRole.ADMIN) {
        throw new BadRequestException('Разделы суперадмина не настраиваются');
      }
      data.adminSections = this.ensureNonEmptyAssignableSections(dto.adminSections);
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: staffUserSelect,
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'StaffUser',
      entityId: id,
      path: opts?.self ? '/settings/admin/staff/me' : `/settings/admin/staff/${id}`,
      actorUserId,
      metadata: {
        kind: dto.isActive === false ? 'staff_deactivated' : 'staff_updated',
        email: current.email,
        before: {
          isActive: current.isActive,
          adminSections: normalizeStoredAdminSections(current.adminSections),
        },
        after: {
          isActive: updated.isActive,
          adminSections: normalizeStoredAdminSections(updated.adminSections),
        },
      },
    });

    this.staffAccess.invalidateStaffAccessCache(id);
    return rowFromUser(updated);
  }

  async resetPassword(
    actorUserId: string,
    id: string,
  ): Promise<{ emailSent: boolean }> {
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        email: true,
        isActive: true,
        staffDisplayName: true,
      },
    });
    if (!current || (current.role !== UserRole.ADMIN && current.role !== UserRole.MODERATOR)) {
      throw new NotFoundException('Сотрудник не найден');
    }
    if (!current.isActive) {
      throw new BadRequestException('Нельзя сбросить пароль деактивированному сотруднику');
    }
    if (!current.email?.trim()) {
      throw new BadRequestException('У сотрудника не задан email для отправки пароля');
    }

    const password = generateStaffPassword();
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'StaffUser',
      entityId: id,
      path: `/settings/admin/staff/${id}/reset-password`,
      actorUserId,
      metadata: {
        kind: 'staff_password_reset',
        email: current.email,
      },
    });

    let emailSent = false;
    try {
      await this.mail.sendStaffAdminPasswordReset({
        to: current.email.trim(),
        password,
        loginUrl: this.resolveAdminLoginUrl(),
        staffDisplayName: current.staffDisplayName,
      });
      emailSent = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Staff password reset email failed for ${current.email}: ${msg}`);
    }

    return { emailSent };
  }

  async touchAdminLogin(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        role: { in: [UserRole.ADMIN, UserRole.MODERATOR] },
      },
      data: { lastAdminLoginAt: new Date() },
    });
  }

  private resolveAdminLoginUrl(): string {
    const base =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '');
    if (!base) {
      throw new BadRequestException('Не задан FRONTEND_PUBLIC_URL для ссылки входа в письме');
    }
    return `${base}/admin/login`;
  }

  private ensureNonEmptyAssignableSections(
    raw: readonly ModeratorAssignableSectionId[],
  ): ModeratorAssignableSectionId[] {
    const sections = normalizeStoredAdminSections(raw);
    if (sections.length === 0) {
      throw new BadRequestException('Выберите хотя бы один раздел');
    }
    return sections;
  }

  private async assertCanDeactivateAdmin(userId: string): Promise<void> {
    const activeAdmins = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true },
    });
    if (activeAdmins <= 1) {
      const self = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
      });
      if (self?.role === UserRole.ADMIN && self.isActive) {
        throw new ForbiddenException('Нельзя деактивировать последнего администратора');
      }
    }
  }
}
