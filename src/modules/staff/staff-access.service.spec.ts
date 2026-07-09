import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { StaffAccessService } from './staff-access.service';

describe('StaffAccessService', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };

  let svc: StaffAccessService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new StaffAccessService(prisma as never);
  });

  it('ADMIN always has all sections', () => {
    expect(svc.effectiveSections(UserRole.ADMIN, []).length).toBeGreaterThan(5);
  });

  it('MODERATOR without orders cannot access orders API path', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['clients'],
      isActive: true,
      role: UserRole.MODERATOR,
    });
    const ok = await svc.canAccessApiPath(
      'u1',
      UserRole.MODERATOR,
      '/api/v1/orders/admin/pending-approval-count',
    );
    expect(ok).toBe(false);
  });

  it('denies unknown admin API paths for MODERATOR', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['orders'],
      isActive: true,
      role: UserRole.MODERATOR,
    });
    const ok = await svc.canAccessApiPath('u1', UserRole.MODERATOR, '/api/v1/unknown/admin/foo');
    expect(ok).toBe(false);
  });

  it('allows staff self profile path via dashboard section', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['clients'],
      isActive: true,
      role: UserRole.MODERATOR,
    });
    const ok = await svc.canAccessApiPath(
      'u1',
      UserRole.MODERATOR,
      '/api/v1/settings/admin/staff/me',
    );
    expect(ok).toBe(true);
  });

  it('blocks deactivated staff account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: false,
      role: UserRole.ADMIN,
      adminSections: [],
      staffDisplayName: null,
      staffAvatarUrl: null,
    });
    expect(await svc.isStaffAccountActive('u1')).toBe(false);
  });

  it('effectiveSections always injects dashboard for moderator', () => {
    expect(svc.effectiveSections(UserRole.MODERATOR, ['orders'])).toEqual([
      'dashboard',
      'orders',
    ]);
  });

  it('listOrderNotifyStaffEmails returns admin and moderators with orders', async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: ' admin@test ' },
      { email: 'mod@test' },
      { email: 'admin@test' },
    ]);
    const emails = await svc.listOrderNotifyStaffEmails();
    expect(emails).toEqual(['admin@test', 'mod@test']);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { role: UserRole.ADMIN },
            { role: UserRole.MODERATOR, adminSections: { has: 'orders' } },
          ]),
        }),
      }),
    );
  });

  it('stripStaffFieldsFromPublicUser removes staff fields for /auth/me clients', () => {
    const user = {
      id: 'u1',
      email: 'mod@test',
      role: UserRole.MODERATOR,
      adminSections: ['orders'],
      staffDisplayName: 'Mod',
      staffAvatarUrl: 'https://cdn/x.png',
      lastAdminLoginAt: new Date(),
    };
    const out = svc.stripStaffFieldsFromPublicUser(user);
    expect(out).toEqual({ id: 'u1', email: 'mod@test', role: UserRole.MODERATOR });
    expect(out).not.toHaveProperty('adminSections');
    expect(out).not.toHaveProperty('staffDisplayName');
  });

  it('uses cache for repeated canAccessApiPath calls', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['orders'],
      isActive: true,
      role: UserRole.MODERATOR,
    });
    await svc.canAccessApiPath('u1', UserRole.MODERATOR, '/api/v1/orders/admin/x');
    await svc.canAccessApiPath('u1', UserRole.MODERATOR, '/api/v1/orders/admin/y');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('assertStaffCanAccessSection throws for inactive moderator', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['clients'],
      isActive: false,
      role: UserRole.MODERATOR,
      staffDisplayName: null,
      staffAvatarUrl: null,
    });
    await expect(
      svc.assertStaffCanAccessSection('u1', UserRole.MODERATOR, 'clients'),
    ).rejects.toThrow('Нет доступа к этому разделу админки');
  });

  it('canAccessSection allows clients for moderator with section', async () => {
    prisma.user.findUnique.mockResolvedValue({
      adminSections: ['clients'],
      isActive: true,
      role: UserRole.MODERATOR,
      staffDisplayName: null,
      staffAvatarUrl: null,
    });
    expect(await svc.canAccessSection('u1', UserRole.MODERATOR, 'clients')).toBe(true);
    expect(await svc.canAccessSection('u1', UserRole.MODERATOR, 'orders')).toBe(false);
  });
});
