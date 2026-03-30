import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(emailOrPhone: string, password: string) {
    const user = await this.usersService.findByEmailOrPhone(emailOrPhone);
    if (user && (await this.usersService.checkPassword(user.id, password))) {
      const { passwordHash: _, ...result } = user;
      return result;
    }
    return null;
  }

  /** Только ADMIN / MODERATOR — для входа в админку */
  async validateStaffUser(emailOrPhone: string, password: string) {
    const user = await this.validateUser(emailOrPhone, password);
    if (!user) return null;
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MODERATOR) return null;
    return user;
  }

  async login(user: { id: string; email: string | null; phone: string | null; role: string }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email ?? undefined,
      role: user.role,
    };
    return { access_token: this.jwtService.sign(payload) };
  }

  async register(dto: { email?: string; phone?: string; password: string }) {
    return this.usersService.create(dto);
  }
}
