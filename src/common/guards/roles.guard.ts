import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { StaffAccessService } from '../../modules/staff/staff-access.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private staffAccess: StaffAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { sub?: string; role?: string };
      path?: string;
      url?: string;
    }>();
    const user = request.user;
    if (!user?.role || !requiredRoles.some((role) => user.role === role)) {
      return false;
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR) {
      if (!user.sub) return false;
      const active = await this.staffAccess.isStaffAccountActive(user.sub);
      if (!active) {
        throw new ForbiddenException('Учётная запись деактивирована');
      }
      if (user.role === UserRole.ADMIN) return true;

      const pathOnly = request.path ?? request.url ?? '';
      const allowed = await this.staffAccess.canAccessApiPath(user.sub, user.role, pathOnly);
      if (!allowed) {
        throw new ForbiddenException('Нет доступа к этому разделу админки');
      }
      return true;
    }

    return false;
  }
}
