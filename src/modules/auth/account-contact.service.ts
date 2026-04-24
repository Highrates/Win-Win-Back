import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AuditAction, RegistrationOtpChannel } from '@prisma/client';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from './mail.service';
import { UnimtxOtpService } from './unimtx-otp.service';
import { AuthService } from './auth.service';
import {
  AccountContactEmailStartDto,
  AccountContactEmailVerifyDto,
  AccountContactPhoneStartDto,
  AccountContactPhoneVerifyDto,
} from './dto/account-contact.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
/** Сколько раз за окно пользователь может запросить SMS/письмо с OTP (и email, и phone вместе). */
const OTP_START_MAX_PER_USER = 5;
const OTP_START_WINDOW_MS = 15 * 60 * 1000;

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
export class AccountContactService {
  private readonly logger = new Logger(AccountContactService.name);

  private readonly startLimitByUser = new Map<string, { count: number; windowEnd: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly smsOtp: UnimtxOtpService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Снижает риск спама SMS и писем с OTP (и перебор по стоимости). */
  private consumeAccountContactOtpStartSlot(userId: string): void {
    const now = Date.now();
    const row = this.startLimitByUser.get(userId);
    if (!row || row.windowEnd < now) {
      this.startLimitByUser.set(userId, { count: 1, windowEnd: now + OTP_START_WINDOW_MS });
      return;
    }
    if (row.count >= OTP_START_MAX_PER_USER) {
      throw new HttpException(
        'Слишком много запросов кода за короткое время. Подождите около 15 минут и попробуйте снова.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    row.count += 1;
  }

  private normalizePhoneE164(raw: string): string {
    const t = raw.trim();
    const digits = (t.startsWith('+') ? t.slice(1) : t).replace(/\D/g, '');
    if (digits.length < 10) throw new BadRequestException('Некорректный номер телефона');
    return digits;
  }

  private phoneDigitsToE164(digits: string): string {
    return `+${digits.replace(/\D/g, '')}`;
  }

  private normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
  }

  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async startEmail(userId: string, dto: AccountContactEmailStartDto, httpPath: string) {
    this.consumeAccountContactOtpStartSlot(userId);
    const newEmail = this.normalizeEmail(dto.email);
    if (!newEmail.includes('@')) {
      throw new BadRequestException('Некорректный email');
    }
    const toDomain = newEmail.split('@')[1] ?? 'unknown';

    const me = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, email: true },
    });
    if (!me) {
      throw new BadRequestException('Пользователь не найден');
    }
    if (me.email && me.email === newEmail) {
      throw new BadRequestException('Этот email уже привязан к аккаунту');
    }

    if (await this.users.isPhoneOrEmailTakenByOther(null, newEmail, userId)) {
      throw new ConflictException('Пользователь с таким email уже зарегистрирован');
    }

    await this.prisma.accountContactChallenge.deleteMany({ where: { userId } });

    const code = this.generateOtp();
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const challenge = await this.prisma.accountContactChallenge.create({
      data: {
        userId,
        channel: RegistrationOtpChannel.EMAIL,
        newEmail,
        newPhone: null,
        codeHash,
        expiresAt,
      },
    });

    try {
      await this.mail.sendRegistrationOtp(newEmail, code);
    } catch (e) {
      await this.prisma.accountContactChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
      this.logger.error(`accountContact startEmail: ${formatMailSendError(e)}`);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Проверьте настройки SMTP или попробуйте позже.',
      );
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: userId,
      httpMethod: 'POST',
      path: httpPath,
      metadata: { op: 'account_contact_otp_start', channel: 'EMAIL' as const, toDomain },
      actorUserId: userId,
    });
    return { message: 'Код отправлен на email' };
  }

  async verifyEmail(userId: string, dto: AccountContactEmailVerifyDto, httpPath: string) {
    const newEmail = this.normalizeEmail(dto.email);
    return this.verifyOtp(
      userId,
      { channel: RegistrationOtpChannel.EMAIL, newEmail, newPhone: null },
      dto.code,
      httpPath,
    );
  }

  async startPhone(userId: string, dto: AccountContactPhoneStartDto, httpPath: string) {
    this.consumeAccountContactOtpStartSlot(userId);
    const newPhone = this.normalizePhoneE164(dto.phone);
    const phoneLast4 = newPhone.length >= 4 ? newPhone.slice(-4) : '****';

    const me = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, phone: true },
    });
    if (!me) {
      throw new BadRequestException('Пользователь не найден');
    }
    if (me.phone && me.phone === newPhone) {
      throw new BadRequestException('Этот телефон уже привязан к аккаунту');
    }

    if (await this.users.isPhoneOrEmailTakenByOther(newPhone, null, userId)) {
      throw new ConflictException('Пользователь с таким телефоном уже зарегистрирован');
    }

    await this.prisma.accountContactChallenge.deleteMany({ where: { userId } });

    const code = this.generateOtp();
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const challenge = await this.prisma.accountContactChallenge.create({
      data: {
        userId,
        channel: RegistrationOtpChannel.PHONE,
        newEmail: null,
        newPhone,
        codeHash,
        expiresAt,
      },
    });

    try {
      await this.smsOtp.sendSmsOtp(this.phoneDigitsToE164(newPhone), code, OTP_TTL_MS / 60000);
    } catch (e) {
      await this.prisma.accountContactChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
      this.logger.error(e);
      const details = e instanceof Error ? e.message : 'Unknown error';
      throw new InternalServerErrorException(`Не удалось отправить SMS. ${details}`      );
    }

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: userId,
      httpMethod: 'POST',
      path: httpPath,
      metadata: { op: 'account_contact_otp_start', channel: 'PHONE' as const, phoneLast4 },
      actorUserId: userId,
    });
    return { message: 'Код отправлен в SMS' };
  }

  async verifyPhone(userId: string, dto: AccountContactPhoneVerifyDto, httpPath: string) {
    const newPhone = this.normalizePhoneE164(dto.phone);
    return this.verifyOtp(
      userId,
      { channel: RegistrationOtpChannel.PHONE, newEmail: null, newPhone },
      dto.code,
      httpPath,
    );
  }

  private async verifyOtp(
    userId: string,
    target: { channel: RegistrationOtpChannel; newEmail: string | null; newPhone: string | null },
    code: string,
    httpPath: string,
  ) {
    const where: {
      userId: string;
      channel: RegistrationOtpChannel;
      newEmail?: string;
      newPhone?: string;
      expiresAt: { gt: Date };
    } = {
      userId,
      channel: target.channel,
      expiresAt: { gt: new Date() },
    };
    if (target.channel === RegistrationOtpChannel.EMAIL) {
      where.newEmail = target.newEmail ?? undefined;
    } else {
      where.newPhone = target.newPhone ?? undefined;
    }

    const challenge = await this.prisma.accountContactChallenge.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new BadRequestException('Код устарел или не найден. Запросите новый.');
    }

    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.accountContactChallenge.delete({ where: { id: challenge.id } });
      throw new BadRequestException('Превышено число попыток. Запросите код заново.');
    }

    const ok = await bcrypt.compare(code, challenge.codeHash);
    if (!ok) {
      await this.prisma.accountContactChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Неверный код');
    }

    if (target.channel === RegistrationOtpChannel.EMAIL) {
      const e = target.newEmail;
      if (!e || e !== challenge.newEmail) {
        throw new BadRequestException('Несовпадение email');
      }
      if (await this.users.isPhoneOrEmailTakenByOther(null, e, userId)) {
        throw new ConflictException('Пользователь с таким email уже зарегистрирован');
      }
    } else {
      const p = target.newPhone;
      if (!p || p !== challenge.newPhone) {
        throw new BadRequestException('Несовпадение телефона');
      }
      if (await this.users.isPhoneOrEmailTakenByOther(p, null, userId)) {
        throw new ConflictException('Пользователь с таким телефоном уже зарегистрирован');
      }
    }

    if (target.channel === RegistrationOtpChannel.EMAIL) {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { email: target.newEmail },
        }),
        this.prisma.accountContactChallenge.delete({ where: { id: challenge.id } }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { phone: target.newPhone },
        }),
        this.prisma.accountContactChallenge.delete({ where: { id: challenge.id } }),
      ]);
    }

    if (target.channel === RegistrationOtpChannel.EMAIL) {
      const dom = (target.newEmail?.split('@')[1] ?? '').slice(0, 120) || 'unknown';
      await this.audit.log({
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: userId,
        httpMethod: 'POST',
        path: httpPath,
        metadata: { op: 'account_contact_confirmed' as const, channel: 'EMAIL' as const, toDomain: dom },
        actorUserId: userId,
      });
    } else {
      const last4 =
        (target.newPhone && target.newPhone.length >= 4
          ? target.newPhone.slice(-4)
          : '****') as string;
      await this.audit.log({
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: userId,
        httpMethod: 'POST',
        path: httpPath,
        metadata: { op: 'account_contact_confirmed' as const, channel: 'PHONE' as const, phoneLast4: last4 },
        actorUserId: userId,
      });
    }

    const user = await this.users.findByIdPublic(userId);
    if (!user) {
      throw new BadRequestException('Пользователь не найден');
    }
    const token = await this.auth.login({
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
    return { access_token: token.access_token, user };
  }
}
