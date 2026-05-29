import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';

const RESET_JWT_MAX = 64 * 1024;
const RESET_TTL = '1h';

export interface PasswordResetJwtPayload {
  purpose: 'password_reset';
  typ: 'pwreset';
  email: string;
}

/** Детали ошибки nodemailer/SMTP для логов (в UI не отдаём). */
function formatMailSendError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const ex = e as Error & { code?: string; responseCode?: number; response?: string; command?: string };
  const parts = [ex.message];
  if (ex.code) parts.push(`code=${ex.code}`);
  if (ex.command) parts.push(`cmd=${ex.command}`);
  if (ex.responseCode != null) parts.push(`smtp=${ex.responseCode}`);
  if (typeof ex.response === 'string' && ex.response.trim()) {
    parts.push(ex.response.trim().slice(0, 400));
  }
  return parts.join(' | ');
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly users: UsersService,
  ) {}

  private secret(): string {
    return (
      this.config.get<string>('PASSWORD_RESET_JWT_SECRET')?.trim() ||
      this.config.get<string>('REGISTRATION_TOKEN_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET', 'dev-secret')
    );
  }

  private publicSiteBase(): string {
    const fromEnv =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '');
    if (fromEnv?.trim()) return fromEnv.trim();

    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    if (!nodeEnv || nodeEnv === 'development') {
      return 'http://localhost:3000';
    }

    throw new BadRequestException('Не задан FRONTEND_PUBLIC_URL для ссылки в письме');
  }

  normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
  }

  /** Всегда один и тот же ответ — не раскрываем, есть ли аккаунт (кроме dev-hint). */
  async requestReset(emailRaw: string): Promise<{ message: string; sent?: boolean; devHint?: string }> {
    const email = this.normalizeEmail(emailRaw);
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user?.email || !user.passwordHash) {
      this.logger.warn(`Password reset skipped: no active user with password for ${email}`);
      return this.buildRequestResponse(false);
    }

    const payload: PasswordResetJwtPayload & { sub: string } = {
      sub: user.id,
      purpose: 'password_reset',
      typ: 'pwreset',
      email,
    };

    const token = await this.jwt.signAsync(payload, { secret: this.secret(), expiresIn: RESET_TTL });
    if (token.length > RESET_JWT_MAX) {
      this.logger.error(`Password reset JWT too long for user ${user.id}`);
      return this.buildRequestResponse(false);
    }

    const link = `${this.publicSiteBase()}/login/reset-password?t=${encodeURIComponent(token)}`;

    try {
      await this.mail.sendPasswordResetLink({ to: email, resetLink: link });
    } catch (e) {
      this.logger.error(`sendPasswordResetLink: ${formatMailSendError(e)}`);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Проверьте настройки SMTP или попробуйте позже.',
      );
    }

    this.logger.log(`Password reset email sent to ${email}`);
    return this.buildRequestResponse(true);
  }

  private isDev(): boolean {
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    return !nodeEnv || nodeEnv === 'development';
  }

  private buildRequestResponse(sent: boolean): { message: string; sent?: boolean; devHint?: string } {
    const message = this.genericRequestMessage();
    if (!this.isDev()) {
      return { message };
    }
    return {
      message,
      sent,
      devHint: sent
        ? 'Письмо отправлено (режим разработки). Проверьте «Входящие» и «Спам».'
        : 'Письмо не отправлено: email не найден в БД или у аккаунта нет пароля. Используйте тот же email, что при регистрации.',
    };
  }

  async verifyToken(token: string): Promise<{ valid: true } | { valid: false; message: string }> {
    const parsed = await this.parseToken(token);
    if (!parsed.ok) {
      return { valid: false, message: parsed.message };
    }
    return { valid: true };
  }

  async confirmReset(token: string, newPassword: string): Promise<{ ok: true }> {
    const parsed = await this.parseToken(token);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.message);
    }

    await this.users.setPasswordWithoutCurrent(parsed.userId, newPassword);
    return { ok: true };
  }

  private genericRequestMessage(): string {
    return 'Если аккаунт с таким email существует, мы отправили письмо со ссылкой для сброса пароля.';
  }

  private async parseToken(
    token: string,
  ): Promise<{ ok: true; userId: string; email: string } | { ok: false; message: string }> {
    const raw = token?.trim();
    if (!raw) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    let payload: PasswordResetJwtPayload & { sub?: string };
    try {
      payload = await this.jwt.verifyAsync<PasswordResetJwtPayload & { sub?: string }>(raw, {
        secret: this.secret(),
      });
    } catch {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    if (payload.purpose !== 'password_reset' || payload.typ !== 'pwreset' || !payload.sub) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    const email = this.normalizeEmail(payload.email ?? '');
    if (!email.includes('@')) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user?.email || user.email.toLowerCase() !== email || !user.passwordHash) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    return { ok: true, userId: user.id, email };
  }
}
