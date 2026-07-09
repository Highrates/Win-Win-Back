import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { StaffAccessService } from '../staff/staff-access.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly staffAccess: StaffAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'dev-secret'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.role === UserRole.ADMIN || payload.role === UserRole.MODERATOR) {
      const active = await this.staffAccess.isStaffAccountActive(payload.sub);
      if (!active) {
        throw new UnauthorizedException('Учётная запись деактивирована');
      }
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }
}
