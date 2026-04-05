import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private audit: AuditService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const path = (req.originalUrl || req.url || '/auth/login').split('?')[0];
    const user = await this.authService.validateUser(dto.emailOrPhone, dto.password);
    if (!user) {
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        path,
        metadata: { channel: 'account' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.log({
      action: AuditAction.LOGIN,
      path,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorEmail: user.email ?? undefined,
      actorRole: user.role,
      metadata: { channel: 'account' },
    });
    return this.authService.login(user);
  }

  /** Вход только для ролей ADMIN / MODERATOR (админ-панель) */
  @Public()
  @Post('admin/login')
  async adminLogin(@Body() dto: LoginDto, @Req() req: Request) {
    const path = (req.originalUrl || req.url || '/auth/admin/login').split('?')[0];
    const user = await this.authService.validateStaffUser(dto.emailOrPhone, dto.password);
    if (!user) {
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        path,
        metadata: { channel: 'admin' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.log({
      action: AuditAction.LOGIN,
      path,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorEmail: user.email ?? undefined,
      actorRole: user.role,
      metadata: { channel: 'admin' },
    });
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser('sub') userId: string) {
    const user = await this.usersService.findByIdPublic(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
