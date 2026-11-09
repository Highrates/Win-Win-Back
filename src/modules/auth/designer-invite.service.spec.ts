import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DesignerInviteService } from './designer-invite.service';

function approvedInviterPrisma(extra?: Record<string, unknown>) {
  const inviter = {
    id: 'U1',
    email: 'inv@example.com',
    role: 'USER',
    profile: {
      winWinPartnerApproved: true,
      winWinReferralCode: 'REF123',
      firstName: 'Ann',
      lastName: 'Lee',
    },
  };
  return {
    user: {
      findFirst: vi.fn(async (args: { where?: { email?: string; id?: string; role?: string } }) => {
        if (args?.where?.email && !args?.where?.id) return null;
        return inviter;
      }),
    },
    referral: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    designerInvite: {
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'INV2' }),
      delete: vi.fn().mockResolvedValue(undefined),
      ...extra,
    },
  } as any;
}

function devConfig() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'JWT_SECRET') return 'dev-secret';
      return undefined;
    }),
  } as any;
}

describe('DesignerInviteService', () => {
  it('listActiveInvitesForUser: статусы pending/accepted/expired/revoked', async () => {
    const now = Date.now();
    const rows = [
      {
        id: 'pending',
        emailNorm: 'p@x.com',
        createdAt: new Date(now - 1000),
        expiresAt: new Date(now + 86400000),
        consumedAt: null,
        rejectedAt: null,
        rejectReason: null,
        revokedAt: null,
      },
      {
        id: 'accepted',
        emailNorm: 'a@x.com',
        createdAt: new Date(now - 2000),
        expiresAt: new Date(now + 86400000),
        consumedAt: new Date(now - 500),
        rejectedAt: null,
        rejectReason: null,
        revokedAt: null,
      },
      {
        id: 'expired',
        emailNorm: 'e@x.com',
        createdAt: new Date(now - 86400000 * 20),
        expiresAt: new Date(now - 1000),
        consumedAt: null,
        rejectedAt: null,
        rejectReason: null,
        revokedAt: null,
      },
      {
        id: 'revoked',
        emailNorm: 'r@x.com',
        createdAt: new Date(now - 3000),
        expiresAt: new Date(now + 86400000),
        consumedAt: null,
        rejectedAt: null,
        rejectReason: null,
        revokedAt: new Date(now - 100),
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
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-active') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, {} as any, {} as any, {} as any);
    const r = await svc.listActiveInvitesForUser('U1');

    expect(prisma.designerInvite.findMany).toHaveBeenCalled();
    expect(r.items.map((i) => i.status)).toEqual(['pending', 'accepted', 'expired', 'revoked']);
    expect(r.items[0]?.inviteLink).toContain('/invite/designer?t=');
    expect(r.items[1]?.inviteLink).toBe('');
    expect(r.statusCounts).toEqual({
      pending: 1,
      pending_admin: 0,
      accepted: 1,
      expired: 1,
      revoked: 1,
      rejected: 0,
    });
    expect(r.total).toBe(4);
    expect(r.truncated).toBe(false);
    expect(r.listLimit).toBe(50);
  });

  it('listActiveInvitesForUser: needs_admin_approval → pending_admin, canRevoke', async () => {
    const now = Date.now();
    const rows = [
      {
        id: 'admin-wait',
        emailNorm: 'w@x.com',
        createdAt: new Date(now - 1000),
        expiresAt: new Date(now + 86400000),
        consumedAt: null,
        rejectedAt: new Date(now - 500),
        rejectReason: 'needs_admin_approval',
        revokedAt: null,
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

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      { signAsync: vi.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const r = await svc.listActiveInvitesForUser('U1');
    expect(r.items[0]).toMatchObject({
      status: 'pending_admin',
      statusLabel: 'Ожидает одобрения админа',
      canRevoke: true,
      canResend: false,
    });
    expect(r.statusCounts.pending_admin).toBe(1);
    expect(r.statusCounts.rejected).toBe(0);
  });

  it('sendInvite: предупреждение о получателе без force — письмо не уходит', async () => {
    const prisma = {
      user: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'U1',
            email: 'inv@example.com',
            profile: { winWinPartnerApproved: true, winWinReferralCode: 'REF123' },
          })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'U2',
            profile: { winWinPartnerApproved: true },
          }),
      },
      designerInvite: {
        count: vi.fn(),
        create: vi.fn(),
      },
    } as any;
    const mail = { sendDesignerInvite: vi.fn() } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, { get: vi.fn() } as any, {} as any, mail, users, {} as any);
    const r = await svc.sendInvite('U1', 'partner@example.com');

    expect(r).toMatchObject({
      ok: false,
      needsConfirmation: true,
      recipientWarning: expect.stringContaining('дизайнеру-партнёру'),
    });
    expect(mail.sendDesignerInvite).not.toHaveBeenCalled();
    expect(prisma.designerInvite.create).not.toHaveBeenCalled();
  });

  it('sendInvite: force: true отправляет несмотря на предупреждение', async () => {
    const prisma = approvedInviterPrisma();
    prisma.user.findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'U1',
        email: 'inv@example.com',
        role: 'USER',
        profile: {
          winWinPartnerApproved: true,
          winWinReferralCode: 'REF123',
          firstName: 'Ann',
          lastName: 'Lee',
        },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'U2',
        profile: { winWinPartnerApproved: true },
      });
    const mail = { sendDesignerInvite: vi.fn().mockResolvedValue(true) } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-new') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, mail, users, {} as any);
    const r = await svc.sendInvite('U1', 'partner@example.com', { force: true });

    expect(r).toMatchObject({ ok: true, emailSent: true });
    expect(mail.sendDesignerInvite).toHaveBeenCalled();
  });

  it('sendInvite: после успеха помечает старые как superseded', async () => {
    const prisma = approvedInviterPrisma();
    const mail = { sendDesignerInvite: vi.fn().mockResolvedValue(true) } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-new') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, mail, users, {} as any);
    const r = await svc.sendInvite('U1', 'guest@example.com');

    expect(mail.sendDesignerInvite).toHaveBeenCalled();
    expect(prisma.designerInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inviterId: 'U1',
          emailNorm: 'guest@example.com',
          consumedAt: null,
          supersededAt: null,
          id: { not: 'INV2' },
        }),
        data: { supersededAt: expect.any(Date) },
      }),
    );
    expect(r).toMatchObject({ ok: true, emailSent: true });
    expect(r.inviteLink).toContain('/invite/designer?t=');
  });

  it('sendInvite: mail вернул 0 → emailSent: false', async () => {
    const prisma = approvedInviterPrisma();
    const mail = { sendDesignerInvite: vi.fn().mockResolvedValue(false) } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok-new') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, mail, users, {} as any);
    const r = await svc.sendInvite('U1', 'guest@example.com');

    expect(r).toMatchObject({ ok: true, emailSent: false });
    expect(r.inviteLink).toBeTruthy();
    expect(prisma.designerInvite.updateMany).toHaveBeenCalled();
  });

  it('sendInvite: сбой SMTP при повторной отправке — старое приглашение не supersede', async () => {
    const prisma = approvedInviterPrisma({ create: vi.fn().mockResolvedValue({ id: 'INV_NEW' }) });
    const mail = {
      sendDesignerInvite: vi.fn().mockRejectedValue(new Error('SMTP down')),
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, mail, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designerInvite.delete).toHaveBeenCalledWith({ where: { id: 'INV_NEW' } });
    expect(prisma.designerInvite.updateMany).not.toHaveBeenCalled();
  });

  it('sendInvite: откатывает запись при ошибке SMTP', async () => {
    const prisma = approvedInviterPrisma({
      create: vi.fn().mockResolvedValue({ id: 'INV1' }),
      updateMany: vi.fn(),
    });
    const mail = {
      sendDesignerInvite: vi.fn().mockRejectedValue(new Error('SMTP down')),
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const jwt = { signAsync: vi.fn().mockResolvedValue('tok') } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, mail, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designerInvite.delete).toHaveBeenCalledWith({ where: { id: 'INV1' } });
  });

  it('sendInvite: лимит 80 приглашений в сутки', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn(async (args: { where?: { email?: string; id?: string } }) => {
          if (args?.where?.email) return null;
          return {
            id: 'U1',
            email: 'inv@example.com',
            profile: { winWinPartnerApproved: true },
          };
        }),
      },
      referral: { findUnique: vi.fn().mockResolvedValue(null) },
      designerInvite: {
        count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(80),
      },
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, { get: vi.fn() } as any, {} as any, {} as any, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toMatchObject({
      message: expect.stringContaining('80'),
    });
  });

  it('sendInvite: блокирует всплеск приглашений', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn(async (args: { where?: { email?: string; id?: string } }) => {
          if (args?.where?.email) return null;
          return {
            id: 'U1',
            email: 'inv@example.com',
            profile: { winWinPartnerApproved: true },
          };
        }),
      },
      referral: { findUnique: vi.fn().mockResolvedValue(null) },
      designerInvite: {
        count: vi.fn().mockResolvedValue(10),
      },
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;

    const svc = new DesignerInviteService(prisma, { get: vi.fn() } as any, {} as any, {} as any, users, {} as any);
    await expect(svc.sendInvite('U1', 'guest@example.com')).rejects.toMatchObject({
      message: expect.stringContaining('короткое время'),
    });
  });

  it('sendInvite: отклоняет email сотрудника', async () => {
    const prisma = {
      user: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'U1',
            email: 'inv@example.com',
            profile: { winWinPartnerApproved: true, winWinReferralCode: 'REF123' },
          })
          .mockResolvedValueOnce({ role: 'MODERATOR' }),
      },
      designerInvite: {
        count: vi.fn(),
        create: vi.fn(),
      },
    } as any;
    const users = { ensureWinWinReferralCodeForUser: vi.fn().mockResolvedValue('REF123') } as any;
    const mail = { sendDesignerInvite: vi.fn() } as any;

    const svc = new DesignerInviteService(prisma, { get: vi.fn() } as any, {} as any, mail, users, {} as any);
    await expect(svc.sendInvite('U1', 'staff@example.com')).rejects.toMatchObject({
      message: expect.stringContaining('сотруднику'),
    });
    expect(prisma.designerInvite.create).not.toHaveBeenCalled();
    expect(mail.sendDesignerInvite).not.toHaveBeenCalled();
  });

  it('verifyToken: accountKind staff для MODERATOR', async () => {
    const prisma = {
      designerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'I1',
          emailNorm: 'staff@mail.ru',
          refCode: 'REF1',
          consumedAt: null,
          supersededAt: null,
          rejectedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          inviter: {
            id: 'U1',
            email: 'p@x.com',
            profile: { winWinPartnerApproved: true, firstName: 'Pat', lastName: null },
          },
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'S1', role: 'MODERATOR' }),
      },
    } as any;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }),
    } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, {} as any, {} as any, {} as any);
    const r = await svc.verifyToken('tok');
    expect(r.accountExists).toBe(true);
    expect(r.accountKind).toBe('staff');
    expect(r.email).toBe('staff@mail.ru');
  });

  it('verifyToken: superseded → понятное сообщение', async () => {
    const prisma = {
      designerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'I1',
          emailNorm: 'a@b.com',
          refCode: 'REF1',
          consumedAt: null,
          supersededAt: new Date(),
          rejectedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          inviter: {
            id: 'U1',
            email: 'p@x.com',
            profile: { winWinPartnerApproved: true },
          },
        }),
      },
    } as any;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }),
    } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, {} as any, {} as any, {} as any);
    await expect(svc.verifyToken('tok')).rejects.toMatchObject({
      message: expect.stringContaining('заменено'),
    });
  });

  it('verifyToken: если пригласивший не партнёр — ошибка', async () => {
    const prisma = {
      designerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'I1',
          emailNorm: 'a@b.com',
          refCode: 'REF1',
          consumedAt: null,
          supersededAt: null,
          rejectedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          inviter: {
            id: 'U1',
            email: 'p@x.com',
            profile: { winWinPartnerApproved: false, firstName: 'Ann', lastName: null },
          },
        }),
      },
    } as any;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }),
    } as any;

    const svc = new DesignerInviteService(prisma, devConfig(), jwt, {} as any, {} as any, {} as any);
    await expect(svc.verifyToken('tok')).rejects.toMatchObject({
      message: expect.stringContaining('больше не является дизайнером-партнёром'),
    });
  });

  it('claimByTokenForUser: уже в команде пригласившего → consumed, без rejected', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'a@b.com',
          profile: { winWinPartnerApproved: false },
          _count: { referralsMade: 0 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
      },
      referral: {
        findUnique: vi.fn().mockResolvedValue({ referrerId: 'INVITER' }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tag: 'tx' })),
    } as any;
    const users = {
      ensurePartnerApplicationReferralCodeIfEmptyInTx: vi.fn().mockResolvedValue(undefined),
      tryAttachWinWinReferralInTx: vi.fn(),
    } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'a@b.com',
      }),
      consumeInTx: vi.fn().mockResolvedValue(true),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(r).toEqual({
      ok: true,
      attached: true,
      alreadyInTeam: true,
      prefillRef: 'REF123',
    });
    expect(inviteClaim.consumeInTx).toHaveBeenCalled();
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
  });

  it('claimByTokenForUser: атомарно — attach + ensure upsert + consume', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'a@b.com',
          profile: { winWinPartnerApproved: false },
          _count: { referralsMade: 0 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
      },
      referral: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tag: 'tx' })),
    } as any;
    const users = {
      tryAttachWinWinReferralInTx: vi
        .fn()
        .mockResolvedValue({ attached: true, sponsorRefCode: 'REF123' }),
      ensurePartnerApplicationReferralCodeIfEmptyInTx: vi.fn().mockResolvedValue(undefined),
    } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'a@b.com',
      }),
      consumeInTx: vi.fn().mockResolvedValue(true),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(users.tryAttachWinWinReferralInTx).toHaveBeenCalledWith({ tag: 'tx' }, 'U1', 'REF123');
    expect(users.ensurePartnerApplicationReferralCodeIfEmptyInTx).toHaveBeenCalledWith(
      { tag: 'tx' },
      'U1',
      'REF123',
    );
    expect(inviteClaim.consumeInTx).toHaveBeenCalledWith({ tag: 'tx' }, 'I1', 'a@b.com');
    expect(r).toEqual({ ok: true, attached: true, prefillRef: 'REF123' });
  });

  it('claimByTokenForUser: пользователь без профиля — claim успешен, приглашение погашено', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'noprofile@b.com',
          profile: null,
          _count: { referralsMade: 0 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
      },
      referral: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ tag: 'tx' })),
    } as any;
    const users = {
      tryAttachWinWinReferralInTx: vi
        .fn()
        .mockResolvedValue({ attached: true, sponsorRefCode: 'REF9' }),
      ensurePartnerApplicationReferralCodeIfEmptyInTx: vi.fn().mockResolvedValue(undefined),
    } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I9',
        refCode: 'REF9',
        emailNorm: 'noprofile@b.com',
      }),
      consumeInTx: vi.fn().mockResolvedValue(true),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(r).toEqual({ ok: true, attached: true, prefillRef: 'REF9' });
    expect(users.ensurePartnerApplicationReferralCodeIfEmptyInTx).toHaveBeenCalled();
    expect(inviteClaim.consumeInTx).toHaveBeenCalledWith({ tag: 'tx' }, 'I9', 'noprofile@b.com');
  });

  it('claimByTokenForUser: одобренный партнёр → needs_admin_approval, без привязки', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'partner@b.com',
          profile: { winWinPartnerApproved: true },
          _count: { referralsMade: 0 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      referral: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any;
    const users = {
      tryAttachWinWinReferralInTx: vi.fn(),
    } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'partner@b.com',
      }),
      consumeInTx: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(r).toMatchObject({
      ok: true,
      attached: false,
      reason: 'needs_admin_approval',
      message: expect.stringContaining('администратора'),
    });
    expect(prisma.designerInvite.update).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: {
        rejectedAt: expect.any(Date),
        rejectReason: 'needs_admin_approval',
        claimantUserId: 'U1',
      },
    });
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
    expect(inviteClaim.consumeInTx).not.toHaveBeenCalled();
  });

  it('claimByTokenForUser: пользователь с downline → needs_admin_approval', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'lead@b.com',
          profile: { winWinPartnerApproved: false },
          _count: { referralsMade: 2 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      referral: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any;
    const users = { tryAttachWinWinReferralInTx: vi.fn() } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I2',
        refCode: 'REF123',
        emailNorm: 'lead@b.com',
      }),
      consumeInTx: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');
    expect(r).toMatchObject({ attached: false, reason: 'needs_admin_approval' });
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
  });

  it('claimByTokenForUser: пользователь с существующим спонсором → attached: false', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'a@b.com',
          profile: { winWinPartnerApproved: false },
          _count: { referralsMade: 0 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      referral: {
        findUnique: vi.fn().mockResolvedValue({ referrerId: 'OTHER_SPONSOR' }),
      },
    } as any;
    const users = {
      tryAttachWinWinReferralInTx: vi.fn(),
      ensurePartnerApplicationReferralCodeIfEmptyInTx: vi.fn(),
    } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'a@b.com',
      }),
      consumeInTx: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(r).toMatchObject({
      ok: true,
      attached: false,
      reason: 'already_has_sponsor',
      message: expect.stringContaining('уже есть спонсор'),
    });
    expect(prisma.designerInvite.update).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: {
        rejectedAt: expect.any(Date),
        rejectReason: 'already_has_sponsor',
      },
    });
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
    expect(inviteClaim.consumeInTx).not.toHaveBeenCalled();
  });

  it('claimByTokenForUser: партнёр с чужим спонсором → already_has_sponsor, не очередь админа', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'partner@b.com',
          profile: { winWinPartnerApproved: true },
          _count: { referralsMade: 3 },
        }),
      },
      designerInvite: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ inviter: { profile: { winWinPartnerApproved: true } } })
          .mockResolvedValueOnce({ inviterId: 'INVITER' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      referral: {
        findUnique: vi.fn().mockResolvedValue({ referrerId: 'OTHER_SPONSOR' }),
      },
    } as any;
    const users = { tryAttachWinWinReferralInTx: vi.fn() } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockResolvedValue({
        inviteId: 'I1',
        refCode: 'REF123',
        emailNorm: 'partner@b.com',
      }),
      consumeInTx: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(r).toMatchObject({ attached: false, reason: 'already_has_sponsor' });
    expect(prisma.designerInvite.update).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: {
        rejectedAt: expect.any(Date),
        rejectReason: 'already_has_sponsor',
      },
    });
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
  });

  it('claimByTokenForUser: если инвайт не подходит — BadRequest', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'a@b.com',
          profile: null,
          _count: { referralsMade: 0 },
        }),
      },
    } as any;
    const users = { tryAttachWinWinReferralInTx: vi.fn() } as any;
    const inviteClaim = {
      resolveActiveForEmail: vi.fn().mockRejectedValue(new BadRequestException('bad')),
      consumeInTx: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn().mockReturnValue('dev-secret') } as any,
      {} as any,
      {} as any,
      users,
      inviteClaim as any,
    );
    await expect(svc.claimByTokenForUser('U1', 'tok')).rejects.toBeInstanceOf(BadRequestException);
    expect(users.tryAttachWinWinReferralInTx).not.toHaveBeenCalled();
  });

  it('adminApproveStructureClaim: привязывает и гасит приглашение', async () => {
    const prisma = {
      designerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'I1',
          emailNorm: 'old@b.com',
          refCode: 'REF123',
          consumedAt: null,
          revokedAt: null,
          supersededAt: null,
          rejectedAt: new Date(),
          rejectReason: 'needs_admin_approval',
          claimantUserId: 'U2',
          expiresAt: new Date(Date.now() + 86400000),
          inviter: {
            id: 'INV',
            email: 'inviter@b.com',
            profile: { winWinPartnerApproved: true, firstName: 'Игорь', lastName: null },
          },
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U2',
          email: 'new@b.com',
          profile: { firstName: 'Анна', lastName: null },
        }),
      },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          designerInvite: { update: prisma.designerInvite.update },
        }),
      ),
    } as any;
    const users = {
      tryAttachWinWinReferralInTx: vi
        .fn()
        .mockResolvedValue({ attached: true, sponsorRefCode: 'REF123' }),
      ensurePartnerApplicationReferralCodeIfEmptyInTx: vi.fn().mockResolvedValue(undefined),
    } as any;
    const inviteClaim = { consumeInTx: vi.fn().mockResolvedValue(true) };
    const mail = {
      sendDesignerInviteStructureApproved: vi.fn().mockResolvedValue(undefined),
      sendDesignerInviteStructureRejected: vi.fn(),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn() } as any,
      {} as any,
      mail as any,
      users,
      inviteClaim as any,
    );
    const r = await svc.adminApproveStructureClaim('I1');

    expect(r).toEqual({
      ok: true,
      attached: true,
      userId: 'U2',
      prefillRef: 'REF123',
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'U2' }) }),
    );
    expect(inviteClaim.consumeInTx).toHaveBeenCalledWith(
      expect.anything(),
      'I1',
      'old@b.com',
      { ignoreExpiry: true },
    );
    expect(mail.sendDesignerInviteStructureApproved).toHaveBeenCalledTimes(2);
  });

  it('adminRejectStructureClaim: помечает admin_rejected и пишет обеим сторонам', async () => {
    const prisma = {
      designerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'I1',
          emailNorm: 'partner@b.com',
          refCode: 'REF123',
          consumedAt: null,
          revokedAt: null,
          supersededAt: null,
          rejectedAt: new Date(),
          rejectReason: 'needs_admin_approval',
          claimantUserId: 'U2',
          expiresAt: new Date(Date.now() + 86400000),
          inviter: {
            id: 'INV',
            email: 'inviter@b.com',
            profile: { winWinPartnerApproved: true, firstName: 'Игорь', lastName: null },
          },
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U2',
          email: 'partner@b.com',
          profile: { firstName: 'Анна', lastName: null },
        }),
      },
    } as any;
    const mail = {
      sendDesignerInviteStructureApproved: vi.fn(),
      sendDesignerInviteStructureRejected: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new DesignerInviteService(
      prisma,
      { get: vi.fn() } as any,
      {} as any,
      mail as any,
      {} as any,
      {} as any,
    );
    const r = await svc.adminRejectStructureClaim('I1');

    expect(r).toEqual({ ok: true, rejected: true, id: 'I1' });
    expect(prisma.designerInvite.update).toHaveBeenCalledWith({
      where: { id: 'I1' },
      data: {
        rejectedAt: expect.any(Date),
        rejectReason: 'admin_rejected',
      },
    });
    expect(mail.sendDesignerInviteStructureRejected).toHaveBeenCalledTimes(2);
  });
});
