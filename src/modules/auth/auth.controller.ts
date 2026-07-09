import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UnauthorizedException,
  HttpException,
  Req,
} from '@nestjs/common';
import { AccountContactService } from './account-contact.service';
import {
  AccountContactEmailStartDto,
  AccountContactEmailVerifyDto,
  AccountContactPhoneStartDto,
  AccountContactPhoneVerifyDto,
} from './dto/account-contact.dto';
import type { Request } from 'express';
import { AuditAction, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoginDto } from './dto/auth.dto';
import {
  RegisterCompleteDto,
  RegisterEmailStartDto,
  RegisterEmailVerifyDto,
  RegisterPhoneStartDto,
  RegisterPhoneVerifyDto,
} from './dto/register-flow.dto';
import { RegistrationService } from './registration.service';
import { DesignerInviteService } from './designer-invite.service';
import { DesignerInviteTokenBodyDto } from './dto/designer-invite.dto';
import { PasswordResetService } from './password-reset.service';
import {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetTokenBodyDto,
} from './dto/password-reset.dto';
import { StaffAccessService } from '../staff/staff-access.service';
import { StaffAdminService } from '../staff/staff-admin.service';
import { Throttle } from '@nestjs/throttler';

/** Per-IP лимиты на чувствительных auth-ручках (перекрывают глобальные 100 req/min). */
const AUTH_LOGIN_THROTTLE = { default: { ttl: 60_000, limit: 15 } };
const AUTH_REGISTER_START_THROTTLE = { default: { ttl: 60_000, limit: 5 } };
const AUTH_REGISTER_VERIFY_THROTTLE = { default: { ttl: 60_000, limit: 10 } };
const AUTH_REGISTER_COMPLETE_THROTTLE = { default: { ttl: 60_000, limit: 10 } };

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private audit: AuditService,
    private registration: RegistrationService,
    private accountContact: AccountContactService,
    private designerInvites: DesignerInviteService,
    private passwordReset: PasswordResetService,
    private staffAccess: StaffAccessService,
    private staffAdmin: StaffAdminService,
  ) {}

  private authPath(req: Request, fallback: string): string {
    return (req.originalUrl || req.url || fallback).split('?')[0];
  }

  private httpExceptionMeta(e: unknown): Record<string, unknown> {
    if (!(e instanceof HttpException)) return {};
    const meta: Record<string, unknown> = { httpStatus: e.getStatus() };
    const r = e.getResponse();
    if (typeof r === 'string') {
      meta.error = r.slice(0, 240);
    } else if (typeof r === 'object' && r !== null && 'message' in r) {
      const m = (r as { message: unknown }).message;
      const text = Array.isArray(m) ? m.join(', ') : String(m);
      meta.error = text.slice(0, 240);
    }
    return meta;
  }

  private async logRegisterFailed(
    path: string,
    step: string,
    e: unknown,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.logAuthSecurityEvent({
      action: AuditAction.REGISTER_FAILED,
      path,
      httpMethod: 'POST',
      metadata: { step, ...extra, ...this.httpExceptionMeta(e) },
    });
  }

  @Public()
  @Throttle(AUTH_REGISTER_START_THROTTLE)
  @Post('register/phone/start')
  async registerPhoneStart(@Body() dto: RegisterPhoneStartDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/register/phone/start');
    try {
      return await this.registration.startPhone(dto);
    } catch (e) {
      await this.logRegisterFailed(path, 'phone/start', e, { channel: 'phone' });
      throw e;
    }
  }

  @Public()
  @Throttle(AUTH_REGISTER_VERIFY_THROTTLE)
  @Post('register/phone/verify')
  async registerPhoneVerify(@Body() dto: RegisterPhoneVerifyDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/register/phone/verify');
    try {
      return await this.registration.verifyPhone(dto);
    } catch (e) {
      await this.logRegisterFailed(path, 'phone/verify', e, { channel: 'phone' });
      throw e;
    }
  }

  @Public()
  @Throttle(AUTH_REGISTER_START_THROTTLE)
  @Post('register/email/start')
  async registerEmailStart(@Body() dto: RegisterEmailStartDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/register/email/start');
    try {
      return await this.registration.startEmail(dto);
    } catch (e) {
      await this.logRegisterFailed(path, 'email/start', e, { channel: 'email' });
      throw e;
    }
  }

  @Public()
  @Throttle(AUTH_REGISTER_VERIFY_THROTTLE)
  @Post('register/email/verify')
  async registerEmailVerify(@Body() dto: RegisterEmailVerifyDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/register/email/verify');
    try {
      return await this.registration.verifyEmail(dto);
    } catch (e) {
      await this.logRegisterFailed(path, 'email/verify', e, { channel: 'email' });
      throw e;
    }
  }

  @Public()
  @Throttle(AUTH_REGISTER_COMPLETE_THROTTLE)
  @Post('register/complete')
  async registerComplete(@Body() dto: RegisterCompleteDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/register/complete');
    try {
      const { user, referralWarning } = await this.registration.complete(dto);
      const token = await this.authService.login({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
      });
      const full = await this.usersService.findByIdPublic(user.id);
      await this.audit.log({
        action: AuditAction.REGISTER,
        path,
        httpMethod: 'POST',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        actorEmail: user.email ?? undefined,
        actorRole: user.role,
        metadata: {
          channel: user.phone ? 'phone' : 'email',
          ...(referralWarning ? { referralWarning } : {}),
        },
      });
      return {
        ...token,
        user: full ?? user,
        ...(referralWarning ? { referralWarning } : {}),
      };
    } catch (e) {
      await this.logRegisterFailed(path, 'complete', e);
      throw e;
    }
  }

  @Public()
  @Throttle(AUTH_LOGIN_THROTTLE)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/login');
    const user = await this.authService.validateUser(dto.emailOrPhone, dto.password);
    if (!user) {
      await this.audit.logAuthSecurityEvent({
        action: AuditAction.LOGIN_FAILED,
        path,
        httpMethod: 'POST',
        metadata: { channel: 'account', httpStatus: 401 },
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
  @Throttle(AUTH_LOGIN_THROTTLE)
  @Post('admin/login')
  async adminLogin(@Body() dto: LoginDto, @Req() req: Request) {
    const path = this.authPath(req, '/auth/admin/login');
    const user = await this.authService.validateStaffUser(dto.emailOrPhone, dto.password);
    if (!user) {
      await this.audit.logAuthSecurityEvent({
        action: AuditAction.LOGIN_FAILED,
        path,
        httpMethod: 'POST',
        metadata: { channel: 'admin', httpStatus: 401 },
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
    await this.staffAdmin.touchAdminLogin(user.id);
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser('sub') userId: string, @CurrentUser('role') role: string) {
    const user = await this.usersService.findByIdPublic(userId);
    if (!user) throw new UnauthorizedException();
    if (role === UserRole.ADMIN || role === UserRole.MODERATOR) {
      const staff = await this.staffAccess.getStaffContext(userId, user.role);
      const publicUser = this.staffAccess.stripStaffFieldsFromPublicUser(user);
      return { ...publicUser, staff };
    }
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/contact/email/start')
  async accountContactEmailStart(
    @CurrentUser('sub') userId: string,
    @Body() dto: AccountContactEmailStartDto,
    @Req() req: Request,
  ) {
    return this.accountContact.startEmail(
      userId,
      dto,
      (req.originalUrl || req.url || '').split('?')[0],
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/contact/email/verify')
  async accountContactEmailVerify(
    @CurrentUser('sub') userId: string,
    @Body() dto: AccountContactEmailVerifyDto,
    @Req() req: Request,
  ) {
    return this.accountContact.verifyEmail(
      userId,
      dto,
      (req.originalUrl || req.url || '').split('?')[0],
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/contact/phone/start')
  async accountContactPhoneStart(
    @CurrentUser('sub') userId: string,
    @Body() dto: AccountContactPhoneStartDto,
    @Req() req: Request,
  ) {
    return this.accountContact.startPhone(
      userId,
      dto,
      (req.originalUrl || req.url || '').split('?')[0],
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('account/contact/phone/verify')
  async accountContactPhoneVerify(
    @CurrentUser('sub') userId: string,
    @Body() dto: AccountContactPhoneVerifyDto,
    @Req() req: Request,
  ) {
    return this.accountContact.verifyPhone(
      userId,
      dto,
      (req.originalUrl || req.url || '').split('?')[0],
    );
  }

  /** Публично: что в ссылке из письма (регистрация / вход, prefill ref). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('designer-invite/verify')
  async verifyDesignerInvite(@Body() dto: DesignerInviteTokenBodyDto) {
    return this.designerInvites.verifyToken(dto.token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('password-reset/request')
  async passwordResetRequest(@Body() dto: PasswordResetRequestDto) {
    return this.passwordReset.requestReset(dto.email);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('password-reset/verify')
  async passwordResetVerify(@Body() dto: PasswordResetTokenBodyDto) {
    return this.passwordReset.verifyToken(dto.token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password-reset/confirm')
  async passwordResetConfirm(@Body() dto: PasswordResetConfirmDto) {
    return this.passwordReset.confirmReset(dto.token, dto.password);
  }
}
