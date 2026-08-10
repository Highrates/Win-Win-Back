import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { ProductQaPublicController } from './product-qa-public.controller';
import type { ProductQaService } from './product-qa.service';

@Injectable()
class DenyUnlessPublicGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    if (!req.user?.sub) throw new UnauthorizedException();
    return true;
  }
}

describe('ProductQaPublicController (Nest guards)', () => {
  const qa = {
    getMetaBySlug: vi.fn(),
    postMessageBySlug: vi.fn(),
  };
  const correspondence = {
    postBySlug: vi.fn(),
  };

  let controller: ProductQaPublicController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProductQaPublicController(
      qa as unknown as ProductQaService,
      { verify: vi.fn() } as unknown as JwtService,
      correspondence as never,
    );
  });

  it('GET meta is public (no guard on handler when invoked directly)', async () => {
    qa.getMetaBySlug.mockResolvedValue({ messageCount: 0, threadId: null, topics: [] });
    await expect(controller.meta('chair')).resolves.toEqual({
      messageCount: 0,
      threadId: null,
      topics: [],
    });
  });

  it('POST messages requires auth via JwtAuthGuard metadata simulation', () => {
    const reflector = new Reflector();
    const guard = new DenyUnlessPublicGuard(reflector);
    const postHandler = ProductQaPublicController.prototype.post;
    const ctx = {
      getHandler: () => postHandler,
      getClass: () => ProductQaPublicController,
      switchToHttp: () => ({
        getRequest: () => ({ user: undefined }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('POST messages delegates to correspondence for USER', async () => {
    correspondence.postBySlug.mockResolvedValue({ id: 'cm1' });
    const out = await controller.post(
      { sub: 'u1', role: UserRole.USER, email: 'u@test.com' },
      'chair',
      { body: 'Q?' },
    );
    expect(out).toEqual({ id: 'cm1' });
    expect(correspondence.postBySlug).toHaveBeenCalledWith('chair', 'u1', UserRole.USER, { body: 'Q?' });
  });
});
