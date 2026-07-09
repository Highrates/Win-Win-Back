import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { StaffAccessService } from './staff-access.service';
import { StaffAdminService } from './staff-admin.service';

describe('StaffAdminService', () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const audit = { log: vi.fn() };
  const mail = {
    sendStaffAdminWelcome: vi.fn().mockResolvedValue(undefined),
    sendStaffAdminPasswordReset: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'FRONTEND_PUBLIC_URL') return 'https://win-win.example';
      return undefined;
    }),
  };
  const staffAccess = new StaffAccessService(prisma as never);
  const users = { uploadUserAvatarImage: vi.fn().mockResolvedValue({ publicUrl: 'https://cdn/a.jpg' }) };

  let svc: StaffAdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new StaffAdminService(
      prisma as never,
      audit as never,
      staffAccess,
      mail as never,
      config as never,
      users as never,
    );
  });

  it('blocks deactivating last active admin', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'a1',
      email: 'admin@test',
      role: UserRole.ADMIN,
      isActive: true,
      staffDisplayName: null,
      staffAvatarUrl: null,
      adminSections: [],
      lastAdminLoginAt: null,
      createdAt: new Date(),
    });
    prisma.user.count.mockResolvedValue(1);

    await expect(
      svc.updateStaff('actor', 'a1', { isActive: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sends welcome email when creating staff and writes audit', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'm1',
      email: 'mod@test',
      role: UserRole.MODERATOR,
      isActive: true,
      staffDisplayName: 'Mod',
      staffAvatarUrl: null,
      adminSections: ['orders'],
      lastAdminLoginAt: null,
      createdAt: new Date(),
    });

    const result = await svc.createStaff('actor', {
      email: 'mod@test',
      staffDisplayName: 'Mod',
      adminSections: ['orders'],
    });

    expect(result.emailSent).toBe(true);
    expect(mail.sendStaffAdminWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'mod@test',
        loginUrl: 'https://win-win.example/admin/login',
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        entityType: 'StaffUser',
        entityId: 'm1',
        metadata: expect.objectContaining({ kind: 'staff_created', email: 'mod@test' }),
      }),
    );
  });

  it('returns emailSent false when welcome email fails but user is created', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'm2',
      email: 'mod2@test',
      role: UserRole.MODERATOR,
      isActive: true,
      staffDisplayName: null,
      staffAvatarUrl: null,
      adminSections: ['clients'],
      lastAdminLoginAt: null,
      createdAt: new Date(),
    });
    mail.sendStaffAdminWelcome.mockRejectedValue(new Error('SMTP down'));

    const result = await svc.createStaff('actor', {
      email: 'mod2@test',
      adminSections: ['clients'],
    });

    expect(result.user.email).toBe('mod2@test');
    expect(result.emailSent).toBe(false);
    expect(audit.log).toHaveBeenCalled();
  });

  it('sends password reset email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'm1',
      role: UserRole.MODERATOR,
      email: 'mod@test',
      isActive: true,
      staffDisplayName: 'Mod',
    });
    prisma.user.update.mockResolvedValue({});

    const result = await svc.resetPassword('actor', 'm1');

    expect(result.emailSent).toBe(true);
    expect(mail.sendStaffAdminPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'mod@test',
        loginUrl: 'https://win-win.example/admin/login',
      }),
    );
  });

  it('soft-deletes moderator and writes audit', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'm1',
      email: 'mod@test',
      role: UserRole.MODERATOR,
      isActive: true,
      staffDisplayName: 'Mod',
      staffAvatarUrl: null,
      adminSections: ['orders'],
      lastAdminLoginAt: null,
      createdAt: new Date(),
    });
    prisma.user.update.mockResolvedValue({});

    await svc.deleteStaff('actor', 'm1');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({
          isActive: false,
          email: 'staff-deleted-m1@invalid.local',
          passwordHash: null,
          staffDisplayName: null,
          staffAvatarUrl: null,
          adminSections: [],
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DELETE,
        entityType: 'StaffUser',
        entityId: 'm1',
        metadata: expect.objectContaining({ kind: 'staff_deleted', previousEmail: 'mod@test' }),
      }),
    );
  });

  it('blocks self-delete', async () => {
    await expect(svc.deleteStaff('m1', 'm1')).rejects.toThrow('Нельзя удалить свою учётную запись');
  });
});
