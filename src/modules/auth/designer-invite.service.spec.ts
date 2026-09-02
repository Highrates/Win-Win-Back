import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DesignerInviteService } from './designer-invite.service';

describe('DesignerInviteService', () => {
  it('listActiveInvitesForUser: только активные инвайты с ссылкой', async () => {
    const rows = [
      {
        id: 'I1',
        emailNorm: 'a@b.com',
        createdAt: new Date('2026-06-01T10:00:00Z'),
        expiresAt: new Date('2026-06-15T10:00:00Z'),
      },
    ];
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          profile: { winWinPartnerApproved: true },
        }),
      },
      designerInvite: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    } as any;
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'JWT_SECRET') return 'dev-secret';
        return undefined;
      }),
    } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-active') } as any;
    const mail = {} as any;
    const users = {} as any;
    const inviteClaim = {} as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, inviteClaim);
    const r = await svc.listActiveInvitesForUser('U1');

    expect(prisma.designerInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inviterId: 'U1',
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.email).toBe('a@b.com');
    expect(r.items[0]?.inviteLink).toContain('/invite/designer?t=');
  });

  it('sendInvite: отзывает предыдущие активные приглашения на тот же email', async () => {
    const row = { id: 'INV2' };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'inv@example.com',
          profile: {
            winWinPartnerApproved: true,
            winWinReferralCode: 'REF123',
            firstName: 'Ann',
            lastName: 'Lee',
          },
        }),
      },
      designerInvite: {
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(row),
      },
    } as any;
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'JWT_SECRET') return 'dev-secret';
        return undefined;
      }),
    } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-new') } as any;
    const mail = { sendDesignerInvite: vi.fn().mockResolvedValue(undefined) } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, {} as any);
    await svc.sendInvite('U1', 'guest@example.com');

    expect(prisma.designerInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inviterId: 'U1',
          emailNorm: 'guest@example.com',
          consumedAt: null,
        }),
        data: { consumedAt: expect.any(Date) },
      }),
    );
    expect(prisma.designerInvite.create).toHaveBeenCalled();
    expect(mail.sendDesignerInvite).toHaveBeenCalled();
  });

  it('sendInvite: откатывает запись при ошибке SMTP', async () => {
    const row = { id: 'INV1' };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'inv@example.com',
          profile: {
            winWinPartnerApproved: true,
            winWinReferralCode: 'REF123',
            firstName: 'Ann',
            lastName: 'Lee',
          },
        }),
      },
      designerInvite: {
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue(row),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'JWT_SECRET') return 'dev-secret';
        return undefined;
      }),
    } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok') } as any;
    const mail = {
      sendDesignerInvite: vi.fn().mockRejectedValue(new Error('SMTP down')),
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designerInvite.delete).toHaveBeenCalledWith({ where: { id: 'INV1' } });
  });

  it('sendInvite: лимит 100 приглашений в сутки', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'inv@example.com',
          profile: { winWinPartnerApproved: true },
        }),
      },
      designerInvite: {
        count: vi.fn().mockResolvedValue(100),
      },
    } as any;
    const config = { get: vi.fn() } as any;
    const jwt = {} as any;
    const mail = {} as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toMatchObject({
      message: expect.stringContaining('100'),
    });
  });

  it('claimByTokenForUser: применяет ref и помечает инвайт consumed', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'U1', email: 'a@b.com' }) },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = {} as any;
    const mail = {} as any;
    const users = { tryAttachWinWinReferralByCodeForExistingUser: vi.fn().mockResolvedValue(undefined) } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'a@b.com',
      }),
      markConsumed: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, inviteClaim as any);
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(inviteClaim.resolveActiveForEmail).toHaveBeenCalledWith(
      'tok',
      'a@b.com',
      'Приглашение не подходит к этому аккаунту',
    );
    expect(users.tryAttachWinWinReferralByCodeForExistingUser).toHaveBeenCalledWith('U1', 'REF123');
    expect(inviteClaim.markConsumed).toHaveBeenCalledWith('I1');
    expect(r).toEqual({ ok: true, prefillRef: 'REF123' });
  });

  it('claimByTokenForUser: если инвайт не подходит — BadRequest', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'U1', email: 'a@b.com' }) },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = {} as any;
    const mail = {} as any;
    const users = { tryAttachWinWinReferralByCodeForExistingUser: vi.fn() } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockRejectedValue(new BadRequestException('bad')),
      markConsumed: vi.fn(),
    };

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users, inviteClaim as any);
    await expect(svc.claimByTokenForUser('U1', 'tok')).rejects.toBeInstanceOf(BadRequestException);
    expect(users.tryAttachWinWinReferralByCodeForExistingUser).not.toHaveBeenCalled();
  });
});

