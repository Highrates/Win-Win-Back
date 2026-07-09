import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const staffAccess = {
    isStaffAccountActive: vi.fn(),
    canAccessApiPath: vi.fn(),
  };
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;
    guard = new RolesGuard(reflector, staffAccess as never);
  });

  function httpContext(path: string, user?: { sub: string; role: string }) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user, path, url: path }),
      }),
    } as ExecutionContext;
  }

  it('allows request when no roles required', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(httpContext('/any'))).resolves.toBe(true);
  });

  it('rejects inactive staff with ForbiddenException', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MODERATOR]);
    staffAccess.isStaffAccountActive.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        httpContext('/api/v1/orders/admin', { sub: 'u1', role: UserRole.MODERATOR }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows active ADMIN without section check', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    staffAccess.isStaffAccountActive.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        httpContext('/api/v1/settings/admin/staff', { sub: 'a1', role: UserRole.ADMIN }),
      ),
    ).resolves.toBe(true);
    expect(staffAccess.canAccessApiPath).not.toHaveBeenCalled();
  });

  it('denies MODERATOR on unmapped admin path', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MODERATOR]);
    staffAccess.isStaffAccountActive.mockResolvedValue(true);
    staffAccess.canAccessApiPath.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        httpContext('/api/v1/unknown/admin/foo', { sub: 'u1', role: UserRole.MODERATOR }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows MODERATOR when canAccessApiPath passes', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MODERATOR]);
    staffAccess.isStaffAccountActive.mockResolvedValue(true);
    staffAccess.canAccessApiPath.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        httpContext('/api/v1/orders/admin/count', { sub: 'u1', role: UserRole.MODERATOR }),
      ),
    ).resolves.toBe(true);
  });
});
