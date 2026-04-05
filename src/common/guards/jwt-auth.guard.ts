import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { requestContextAls } from '../request-context/request-context.storage';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const ok = (await super.canActivate(context)) as boolean;
    if (ok) {
      const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
      const u = req.user;
      const store = requestContextAls.getStore();
      if (store && u) {
        store.currentUser = { sub: u.sub, email: u.email, role: u.role };
      }
    }
    return ok;
  }
}
