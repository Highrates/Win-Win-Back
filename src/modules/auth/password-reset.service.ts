import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveSecret } from '../../config/resolve-secret';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';

const RESET_JWT_MAX = 64 * 1024;
const RESET_TTL = '1h';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface PasswordResetJwtPayload {
  purpose: 'password_reset';
  typ: 'pwreset';
  jti: string;
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
      resolveSecret('JWT_SECRET', this.config.get<string>('JWT_SECRET'))
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

  private sentMessage(): string {
    return 'Мы отправили письмо со ссылкой для сброса пароля. Проверьте «Входящие» и «Спам».';
  }

  /** Нейтральный ответ без письма — не палим наличие аккаунта. */
  private async neutralResetResponse(): Promise<{ message: string; sent: true }> {
    await new Promise((r) => setTimeout(r, 200 + randomInt(0, 300)));
    return { message: this.sentMessage(), sent: true };
  }

  /**
   * Сброс пароля только для розничных покупателей (`USER`).
   * Staff (ADMIN/MODERATOR) — через админку, иначе попадали бы в ЛК, но не в «Клиенты».
   */
  async requestReset(emailRaw: string): Promise<{ message: string; sent: true }> {
    const email = this.normalizeEmail(emailRaw);
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true, role: UserRole.USER },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user?.email || !user.passwordHash) {
      this.logger.warn(`Password reset skipped: no active USER with password for ${email}`);
      return this.neutralResetResponse();
    }

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
    await this.prisma.passwordResetToken.create({
      data: { id: jti, userId: user.id, expiresAt },
    });

    const payload: PasswordResetJwtPayload & { sub: string } = {
      sub: user.id,
      purpose: 'password_reset',
      typ: 'pwreset',
      jti,
      email,
    };

    const token = await this.jwt.signAsync(payload, { secret: this.secret(), expiresIn: RESET_TTL });
    if (token.length > RESET_JWT_MAX) {
      await this.prisma.passwordResetToken.delete({ where: { id: jti } }).catch(() => {});
      this.logger.error(`Password reset JWT too long for user ${user.id}`);
      throw new InternalServerErrorException('Не удалось подготовить ссылку. Попробуйте позже.');
    }

    const link = `${this.publicSiteBase()}/login/reset-password?t=${encodeURIComponent(token)}`;

    try {
      await this.mail.sendPasswordResetLink({ to: email, resetLink: link });
    } catch (e) {
      await this.prisma.passwordResetToken.delete({ where: { id: jti } }).catch(() => {});
      this.logger.error(`sendPasswordResetLink: ${formatMailSendError(e)}`);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Проверьте настройки SMTP или попробуйте позже.',
      );
    }

    this.logger.log(`Password reset email sent to ${email}`);
    return { message: this.sentMessage(), sent: true };
  }

  async verifyToken(
    token: string,
  ): Promise<{ valid: true; email: string } | { valid: false; message: string }> {
    const parsed = await this.parseToken(token);
    if (!parsed.ok) {
      return { valid: false, message: parsed.message };
    }
    return { valid: true, email: parsed.email };
  }

  async confirmReset(token: string, newPassword: string): Promise<{ ok: true; email: string }> {
    const parsed = await this.parseToken(token);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.message);
    }

    await this.consumeResetToken(parsed.jti);

    await this.users.setPasswordWithoutCurrent(parsed.userId, newPassword);
    return { ok: true, email: parsed.email };
  }

  private async consumeResetToken(jti: string): Promise<void> {
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: {
        id: jti,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
  }

  private async parseToken(
    token: string,
  ): Promise<
    { ok: true; userId: string; email: string; jti: string } | { ok: false; message: string }
  > {
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

    if (
      payload.purpose !== 'password_reset' ||
      payload.typ !== 'pwreset' ||
      !payload.sub ||
      !payload.jti?.trim()
    ) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    const email = this.normalizeEmail(payload.email ?? '');
    if (!email.includes('@')) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    const row = await this.prisma.passwordResetToken.findFirst({
      where: {
        id: payload.jti,
        userId: payload.sub,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!row) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, role: UserRole.USER },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user?.email || user.email.toLowerCase() !== email || !user.passwordHash) {
      return { ok: false, message: 'Ссылка недействительна или истекла' };
    }

    return { ok: true, userId: user.id, email, jti: payload.jti };
  }
}
