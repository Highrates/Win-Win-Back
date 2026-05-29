import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService', () => {
  it('requestReset: без пользователя — generic message, без отправки письма', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = { signAsync: vi.fn() } as any;
    const mail = { sendPasswordResetLink: vi.fn() } as any;
    const users = { setPasswordWithoutCurrent: vi.fn() } as any;

    const svc = new PasswordResetService(prisma, config, jwt, mail, users);
    const r = await svc.requestReset('ghost@example.com');

    expect(r.message).toContain('Если аккаунт');
    expect(mail.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it('confirmReset: валидный токен — меняет пароль', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'a@b.com',
          passwordHash: 'hash',
        }),
      },
    } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 'U1',
        purpose: 'password_reset',
        typ: 'pwreset',
        email: 'a@b.com',
      }),
    } as any;
    const mail = {} as any;
    const users = { setPasswordWithoutCurrent: vi.fn().mockResolvedValue({ ok: true }) } as any;

    const svc = new PasswordResetService(prisma, config, jwt, mail, users);
    const r = await svc.confirmReset('tok', 'newpassword1');

    expect(users.setPasswordWithoutCurrent).toHaveBeenCalledWith('U1', 'newpassword1');
    expect(r).toEqual({ ok: true });
  });

  it('confirmReset: неверный purpose — BadRequest', async () => {
    const prisma = { user: { findFirst: vi.fn() } } as any;
    const config = { get: vi.fn().mockReturnValue('dev-secret') } as any;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: 'U1',
        purpose: 'other',
        typ: 'pwreset',
        email: 'a@b.com',
      }),
    } as any;
    const mail = {} as any;
    const users = { setPasswordWithoutCurrent: vi.fn() } as any;

    const svc = new PasswordResetService(prisma, config, jwt, mail, users);
    await expect(svc.confirmReset('tok', 'newpassword1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
