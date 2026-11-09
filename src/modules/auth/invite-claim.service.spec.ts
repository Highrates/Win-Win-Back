import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteClaimService } from './invite-claim.service';

function makeSvc(overrides?: {
  findFirst?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  verifyAsync?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    designerInvite: {
      findFirst: overrides?.findFirst ?? vi.fn(),
      findUnique:
        overrides?.findUnique ??
        vi.fn().mockResolvedValue({
          id: 'I1',
          refCode: 'REF1',
          emailNorm: 'a@b.com',
          consumedAt: null,
          supersededAt: null,
          rejectedAt: null,
          rejectReason: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86400000),
        }),
      update: overrides?.update ?? vi.fn().mockResolvedValue(undefined),
    },
  };
  const jwt = {
    verifyAsync: overrides?.verifyAsync ?? vi.fn().mockResolvedValue({ sub: 'I1', typ: 'dinv' }),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'JWT_SECRET' ? 'dev-secret' : undefined)),
  };
  const svc = new InviteClaimService(prisma as never, jwt as never, config as never);
  return { svc, prisma, jwt };
}

describe('InviteClaimService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('registration branch (resolveForNewRegistration + consumeInTx)', () => {
    it('returns null when token absent', async () => {
      const { svc } = makeSvc();
      await expect(svc.resolveForNewRegistration(null, 'a@b.com')).resolves.toBeNull();
      await expect(svc.resolveForNewRegistration('  ', 'a@b.com')).resolves.toBeNull();
    });

    it('rejects invite without registration email', async () => {
      const { svc } = makeSvc();
      await expect(svc.resolveForNewRegistration('tok', null)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves active invite for matching email', async () => {
      const findUnique = vi.fn().mockResolvedValue({
        id: 'I1',
        refCode: 'REF1',
        emailNorm: 'a@b.com',
        consumedAt: null,
        supersededAt: null,
        rejectedAt: null,
        rejectReason: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { svc } = makeSvc({ findUnique });
      const r = await svc.resolveForNewRegistration('tok', 'A@B.com');
      expect(r).toEqual({ inviteId: 'I1', refCode: 'REF1' });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'I1' },
        select: expect.objectContaining({ id: true, emailNorm: true, supersededAt: true, rejectedAt: true }),
      });
    });

    it('rejects superseded invite with clear message', async () => {
      const findUnique = vi.fn().mockResolvedValue({
        id: 'I1',
        refCode: 'REF1',
        emailNorm: 'a@b.com',
        consumedAt: null,
        supersededAt: new Date(),
        rejectedAt: null,
        rejectReason: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { svc } = makeSvc({ findUnique });
      await expect(svc.resolveForNewRegistration('tok', 'a@b.com')).rejects.toThrow(/заменено/);
    });

    it('consumeInTx marks invite consumed when still active', async () => {
      const tx = {
        designerInvite: {
          findFirst: vi.fn().mockResolvedValue({ id: 'I1' }),
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      const { svc } = makeSvc();
      const ok = await svc.consumeInTx(tx as never, 'I1', 'a@b.com');
      expect(ok).toBe(true);
      expect(tx.designerInvite.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'I1',
            consumedAt: null,
            supersededAt: null,
            rejectedAt: null,
            revokedAt: null,
          }),
        }),
      );
      expect(tx.designerInvite.update).toHaveBeenCalledWith({
        where: { id: 'I1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('consumeInTx is no-op when invite already gone', async () => {
      const tx = {
        designerInvite: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
      };
      const { svc } = makeSvc();
      await expect(svc.consumeInTx(tx as never, 'I1', 'a@b.com')).resolves.toBe(false);
      expect(tx.designerInvite.update).not.toHaveBeenCalled();
    });
  });

  describe('login/claim branch (resolveActiveForEmail + markConsumed)', () => {
    it('resolves for account email', async () => {
      const findUnique = vi.fn().mockResolvedValue({
        id: 'I1',
        refCode: 'REF9',
        emailNorm: 'u@x.com',
        consumedAt: null,
        supersededAt: null,
        rejectedAt: null,
        rejectReason: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { svc } = makeSvc({ findUnique });
      const r = await svc.resolveActiveForEmail('tok', 'u@x.com', 'Приглашение не подходит к этому аккаунту');
      expect(r).toEqual({ inviteId: 'I1', refCode: 'REF9', emailNorm: 'u@x.com' });
    });

    it('rejects mismatched invite', async () => {
      const findUnique = vi.fn().mockResolvedValue({
        id: 'I1',
        refCode: 'REF9',
        emailNorm: 'other@x.com',
        consumedAt: null,
        supersededAt: null,
        rejectedAt: null,
        rejectReason: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { svc } = makeSvc({ findUnique });
      await expect(
        svc.resolveActiveForEmail('tok', 'u@x.com', 'Приглашение не подходит к этому аккаунту'),
      ).rejects.toThrow(/аккаунту/);
    });

    it('markConsumed updates row', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const { svc, prisma } = makeSvc({ update });
      await svc.markConsumed('I1');
      expect(prisma.designerInvite.update).toHaveBeenCalledWith({
        where: { id: 'I1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('rejects bad jwt typ', async () => {
      const { svc } = makeSvc({
        verifyAsync: vi.fn().mockResolvedValue({ sub: 'I1', typ: 'other' }),
      });
      await expect(svc.resolveActiveForEmail('tok', 'a@b.com')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
