import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RegistrationOtpChannel } from '@prisma/client';
import { DesignerInviteService } from './designer-invite.service';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';
import { UnimtxOtpService } from './unimtx-otp.service';
import {
  RegisterCompleteDto,
  RegisterEmailStartDto,
  RegisterEmailVerifyDto,
  RegisterPhoneStartDto,
  RegisterPhoneVerifyDto,
} from './dto/register-flow.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

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

export interface RegistrationCompletionJwtPayload {
  purpose: 'register_complete';
  phone: string | null;
  email: string | null;
  consentPersonalData: boolean;
  consentSms: boolean;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly smsOtp: UnimtxOtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly designerInvites: DesignerInviteService,
  ) {}

  private regTokenSecret(): string {
    return (
      this.config.get<string>('REGISTRATION_TOKEN_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET', 'dev-secret')
    );
  }

  /** Только цифры страны и абонента, без «+». */
  normalizePhoneE164(raw: string): string {
    const t = raw.trim();
    const digits = (t.startsWith('+') ? t.slice(1) : t).replace(/\D/g, '');
    if (digits.length < 10) throw new BadRequestException('Некорректный номер телефона');
    return digits;
  }

  /** E.164 для Unimatrix: + и только цифры после него. */
  private phoneDigitsToE164(digits: string): string {
    return `+${digits.replace(/\D/g, '')}`;
  }

  normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
  }

  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async startPhone(dto: RegisterPhoneStartDto): Promise<{ message: string }> {
    const phone = this.normalizePhoneE164(dto.phone);

    const taken = await this.users.existsByPhoneOrEmail(phone, null);
    if (taken) {
      throw new ConflictException('Пользователь с таким телефоном уже зарегистрирован');
    }

    await this.prisma.registrationChallenge.deleteMany({ where: { phone } });

    // Код генерируем у нас, а доставку делаем через Unimatrix sms.message.send (с signature).
    const code = this.generateOtp();
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const challenge = await this.prisma.registrationChallenge.create({
      data: {
        channel: RegistrationOtpChannel.PHONE,
        phone,
        email: null,
        codeHash,
        expiresAt,
        consentPersonalData: dto.consentPersonalData,
        consentSms: dto.consentSms,
      },
    });

    try {
      await this.smsOtp.sendSmsOtp(this.phoneDigitsToE164(phone), code, OTP_TTL_MS / 60000);
    } catch (e) {
      await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
      this.logger.error(e);
      const details = e instanceof Error ? e.message : 'Unknown error';
      throw new InternalServerErrorException(
        `Не удалось отправить SMS. ${details}`,
      );
    }

    return { message: 'Код отправлен в SMS' };
  }

  async startEmail(dto: RegisterEmailStartDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email);

    const taken = await this.users.existsByPhoneOrEmail(null, email);
    if (taken) {
      throw new ConflictException('Пользователь с таким email уже зарегистрирован');
    }

    await this.prisma.registrationChallenge.deleteMany({ where: { email } });

    const code = this.generateOtp();
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const challenge = await this.prisma.registrationChallenge.create({
      data: {
        channel: RegistrationOtpChannel.EMAIL,
        phone: null,
        email,
        codeHash,
        expiresAt,
        consentPersonalData: dto.consentPersonalData,
        consentSms: dto.consentSms,
      },
    });

    try {
      await this.mail.sendRegistrationOtp(email, code);
    } catch (e) {
      await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
      this.logger.error(`sendRegistrationOtp: ${formatMailSendError(e)}`);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Проверьте настройки SMTP или попробуйте позже.',
      );
    }

    return { message: 'Код отправлен на email' };
  }

  async verifyPhone(dto: RegisterPhoneVerifyDto): Promise<{ completionToken: string }> {
    const phone = this.normalizePhoneE164(dto.phone);

    const challenge = await this.prisma.registrationChallenge.findFirst({
      where: {
        channel: RegistrationOtpChannel.PHONE,
        phone,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.finishVerify(challenge, dto.code);
  }

  async verifyEmail(dto: RegisterEmailVerifyDto): Promise<{ completionToken: string }> {
    const email = this.normalizeEmail(dto.email);

    const challenge = await this.prisma.registrationChallenge.findFirst({
      where: {
        channel: RegistrationOtpChannel.EMAIL,
        email,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.finishVerify(challenge, dto.code);
  }

  private async issueCompletionTokenFromChallenge(challenge: {
    id: string;
    phone: string | null;
    email: string | null;
    consentPersonalData: boolean;
    consentSms: boolean;
  }): Promise<{ completionToken: string }> {
    await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } });

    const payload: RegistrationCompletionJwtPayload = {
      purpose: 'register_complete',
      phone: challenge.phone,
      email: challenge.email,
      consentPersonalData: challenge.consentPersonalData,
      consentSms: challenge.consentSms,
    };

    const completionToken = await this.jwt.signAsync(
      { ...payload, sub: 'register-complete' },
      { secret: this.regTokenSecret(), expiresIn: '1h' },
    );

    return { completionToken };
  }

  private async finishVerify(
    challenge: {
      id: string;
      phone: string | null;
      email: string | null;
      codeHash: string;
      attempts: number;
      consentPersonalData: boolean;
      consentSms: boolean;
    } | null,
    code: string,
  ): Promise<{ completionToken: string }> {
    if (!challenge) {
      throw new BadRequestException('Код устарел или не найден. Запросите новый.');
    }

    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } });
      throw new BadRequestException('Превышено число попыток. Запросите код заново.');
    }

    const ok = await bcrypt.compare(code, challenge.codeHash);
    if (!ok) {
      await this.prisma.registrationChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Неверный код');
    }

    return this.issueCompletionTokenFromChallenge(challenge);
  }

  async complete(dto: RegisterCompleteDto) {
    let payload: RegistrationCompletionJwtPayload & { sub: string };
    try {
      payload = await this.jwt.verifyAsync<RegistrationCompletionJwtPayload & { sub: string }>(
        dto.completionToken,
        { secret: this.regTokenSecret() },
      );
    } catch {
      throw new BadRequestException('Ссылка подтверждения недействительна или истекла');
    }

    if (payload.purpose !== 'register_complete') {
      throw new BadRequestException('Неверный токен регистрации');
    }

    if (!payload.phone && !payload.email) {
      throw new BadRequestException('Неверный токен регистрации');
    }

    if (dto.designerInviteToken?.trim() && !payload.email) {
      throw new BadRequestException('Приглашение дизайнера доступно только при регистрации по email');
    }

    let inviteResolved: { inviteId: string; refCode: string } | null = null;
    if (dto.designerInviteToken?.trim() && payload.email) {
      inviteResolved = await this.designerInvites.assertValidForNewAccountEmail(
        dto.designerInviteToken,
        payload.email,
      );
    }
    const refFromDto = (dto.referralCode ?? '').trim();
    const refUse = (inviteResolved?.refCode ?? refFromDto) || null;

    return this.users.createRetailUser({
      phone: payload.phone,
      email: payload.email,
      password: dto.password,
      consentPersonalData: payload.consentPersonalData,
      consentSms: payload.consentSms,
      referralCode: refUse,
      designerInviteId: inviteResolved?.inviteId ?? null,
    });
  }
}
