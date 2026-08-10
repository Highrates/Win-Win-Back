import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PasswordResetService } from './password-reset.service';

function makeService(overrides?: {
  user?: { id: string; email: string; passwordHash: string } | null;
  resetTokenRow?: { id: string } | null;
  consumeCount?: number;
}) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(overrides?.user ?? null),
    },
    passwordResetToken: {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      findFirst: vi.fn().mockResolvedValue(overrides?.resetTokenRow ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: overrides?.consumeCount ?? 1 }),
    },
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'FRONTEND_PUBLIC_URL') return 'http://localhost:3000';
      return 'dev-secret';
    }),
  };
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('tok'),
    verifyAsync: vi.fn().mockResolvedValue({
      sub: 'U1',
      purpose: 'password_reset',
      typ: 'pwreset',
      jti: 'jti-1',
      email: 'a@b.com',
    }),
  };
  const mail = { sendPasswordResetLink: vi.fn().mockResolvedValue(undefined) };
  const users = { setPasswordWithoutCurrent: vi.fn().mockResolvedValue({ ok: true }) };

  const svc = new PasswordResetService(prisma as never, config as never, jwt as never, mail as never, users as never);
  return { svc, prisma, mail, users, jwt };
}

describe('PasswordResetService', () => {
  it('requestReset: без пользователя — нейтральный ответ без письма', async () => {
    const { svc, mail } = makeService({ user: null });

    const r = await svc.requestReset('ghost@example.com');

    expect(r.sent).toBe(true);
    expect(r.message).toContain('отправили письмо');
    expect(mail.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it('requestReset: USER с паролем — создаёт one-use token и отправляет письмо', async () => {
    const { svc, mail, prisma } = makeService({
      user: { id: 'U1', email: 'a@b.com', passwordHash: 'hash' },
    });

    const r = await svc.requestReset('a@b.com');

    expect(r.sent).toBe(true);
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(mail.sendPasswordResetLink).toHaveBeenCalled();
  });

  it('confirmReset: валидный токен — consume + меняет пароль', async () => {
    const { svc, users, prisma } = makeService({
      user: { id: 'U1', email: 'a@b.com', passwordHash: 'hash' },
      resetTokenRow: { id: 'jti-1' },
    });

    const r = await svc.confirmReset('tok', 'newpassword1');

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalled();
    expect(users.setPasswordWithoutCurrent).toHaveBeenCalledWith('U1', 'newpassword1');
    expect(r).toEqual({ ok: true, email: 'a@b.com' });
  });

  it('confirmReset: replay — BadRequest', async () => {
    const { svc, users } = makeService({
      user: { id: 'U1', email: 'a@b.com', passwordHash: 'hash' },
      resetTokenRow: { id: 'jti-1' },
      consumeCount: 0,
    });

    await expect(svc.confirmReset('tok', 'newpassword1')).rejects.toBeInstanceOf(BadRequestException);
    expect(users.setPasswordWithoutCurrent).not.toHaveBeenCalled();
  });

  it('confirmReset: неверный purpose — BadRequest', async () => {
    const { svc, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'U1',
      purpose: 'other',
      typ: 'pwreset',
      jti: 'jti-1',
      email: 'a@b.com',
    });

    await expect(svc.confirmReset('tok', 'newpassword1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
