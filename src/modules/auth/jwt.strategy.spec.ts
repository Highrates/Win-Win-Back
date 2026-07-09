import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const staffAccess = { isStaffAccountActive: vi.fn() };
  let strategy: JwtStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new JwtStrategy({ get: () => 'secret' } as never, staffAccess as never);
  });

  it('rejects deactivated ADMIN staff', async () => {
    staffAccess.isStaffAccountActive.mockResolvedValue(false);

    await expect(
      strategy.validate({ sub: 'a1', email: 'a@test', role: UserRole.ADMIN }),
    ).rejects.toThrow(UnauthorizedException);
    expect(staffAccess.isStaffAccountActive).toHaveBeenCalledWith('a1');
  });

  it('rejects deactivated MODERATOR staff', async () => {
    staffAccess.isStaffAccountActive.mockResolvedValue(false);

    await expect(
      strategy.validate({ sub: 'm1', email: 'm@test', role: UserRole.MODERATOR }),
    ).rejects.toThrow('Учётная запись деактивирована');
  });

  it('allows active staff without section check', async () => {
    staffAccess.isStaffAccountActive.mockResolvedValue(true);

    await expect(
      strategy.validate({ sub: 'm1', email: 'm@test', role: UserRole.MODERATOR }),
    ).resolves.toEqual({ sub: 'm1', email: 'm@test', role: UserRole.MODERATOR });
  });

  it('skips staff active check for retail users', async () => {
    await expect(
      strategy.validate({ sub: 'u1', email: 'u@test', role: UserRole.USER }),
    ).resolves.toEqual({ sub: 'u1', email: 'u@test', role: UserRole.USER });
    expect(staffAccess.isStaffAccountActive).not.toHaveBeenCalled();
  });
});
