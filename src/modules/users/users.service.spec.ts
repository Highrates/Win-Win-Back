import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

function makeSvc() {
  const prisma = {} as never;
  const media = {} as never;
  const mail = {} as never;
  return new UsersService(prisma, media, mail);
}

describe('UsersService (referrals)', () => {
  it('winWinReferralLevelInTx: возвращает level=2, если inviter уже L1', async () => {
    const svc = makeSvc() as any;
    const tx = {
      referral: {
        findFirst: vi.fn().mockResolvedValue({ id: 'x' }),
      },
    };
    const level = await svc.winWinReferralLevelInTx(tx, 'inviter');
    expect(level).toBe(2);
  });

  it('assertNoWinWinReferralCycleInTx: запрещает цикл, если referredId — предок referrerId', async () => {
    const svc = makeSvc() as any;
    const tx = {
      referral: {
        findFirst: vi
          .fn()
          // cur = A -> parent = B
          .mockResolvedValueOnce({ referrerId: 'B' })
          // cur = B -> parent = C
          .mockResolvedValueOnce({ referrerId: 'C' })
          // cur = C -> parent = TARGET(referredId)
          .mockResolvedValueOnce({ referrerId: 'TARGET' }),
      },
    };
    await expect(svc.assertNoWinWinReferralCycleInTx(tx, 'A', 'TARGET')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tryAttachWinWinReferralInTx: игнорирует только P2002, но пробрасывает BadRequestException', async () => {
    const svc = makeSvc() as any;
    svc.findActivePartnerByPublicReferralCode = vi.fn().mockResolvedValue({ userId: 'INV', winWinReferralCode: 'REF' });

    const tx = {
      referral: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    // 1) BadRequestException из проверки цикла не должна проглатываться
    svc.assertNoWinWinReferralCycleInTx = vi.fn().mockRejectedValue(new BadRequestException('cycle'));
    await expect(svc.tryAttachWinWinReferralInTx(tx, 'NEW', 'REF')).rejects.toBeInstanceOf(BadRequestException);

    // 2) P2002 должен вернуть false
    svc.assertNoWinWinReferralCycleInTx = vi.fn().mockResolvedValue(undefined);
    tx.referral.create = vi.fn().mockRejectedValue({ code: 'P2002' });
    await expect(svc.tryAttachWinWinReferralInTx(tx, 'NEW', 'REF')).resolves.toBe(false);
  });
});

describe('UsersService (admin delete)', () => {
  it('deleteRetailUserForAdmin deactivates and anonymizes retail user', async () => {
    const userUpdate = vi.fn();
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'u1', isActive: true }),
        update: userUpdate,
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          userGroupMember: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          userProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          designer: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
          user: { update: userUpdate },
        }),
      ),
    };
    const svc = new UsersService(prisma as never, {} as never, {} as never);

    await svc.deleteRetailUserForAdmin('admin1', 'u1');

    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ isActive: false, email: null, phone: null }),
      }),
    );
  });

  it('deleteRetailUserForAdmin rejects already deleted user', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'u1', isActive: false }),
      },
    };
    const svc = new UsersService(prisma as never, {} as never, {} as never);

    await expect(svc.deleteRetailUserForAdmin('admin1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

