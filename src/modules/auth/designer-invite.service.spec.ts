import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DesignerInviteService } from './designer-invite.service';

function makeSvc(overrides?: Partial<ConstructorParameters<typeof DesignerInviteService>[0]>) {
  return overrides;
}

describe('DesignerInviteService', () => {
  it('claimByTokenForUser: применяет ref и помечает инвайт consumed', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'U1', email: 'a@b.com' }) },
      designerInvite: {
        findFirst: vi.fn().mockResolvedValue({ id: 'I1', refCode: 'REF123' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }) } as any;
    const mail = {} as any;
    const users = { tryAttachWinWinReferralByCodeForExistingUser: vi.fn().mockResolvedValue(undefined) } as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users);
    const r = await svc.claimByTokenForUser('U1', 'tok');

    expect(users.tryAttachWinWinReferralByCodeForExistingUser).toHaveBeenCalledWith('U1', 'REF123');
    expect(prisma.designerInvite.update).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, prefillRef: 'REF123' });
  });

  it('claimByTokenForUser: если инвайт не подходит — BadRequest', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'U1', email: 'a@b.com' }) },
      designerInvite: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }) } as any;
    const mail = {} as any;
    const users = { tryAttachWinWinReferralByCodeForExistingUser: vi.fn() } as any;

    const svc = new DesignerInviteService(prisma, config, jwt, mail, users);
    await expect(svc.claimByTokenForUser('U1', 'tok')).rejects.toBeInstanceOf(BadRequestException);
  });
});

