import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RegistrationOtpChannel } from '@prisma/client';
import { DesignerInviteService } from './designer-invite.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from './mail.service';
import { UnimtxOtpService } from './unimtx-otp.service';
import { OtpChallengeService } from './otp-challenge.service';
import { formatMailSendError, formatSmsSendError } from './otp-send-errors';
import {
  normalizeEmail as normalizeEmailShared,
  normalizePhoneE164 as normalizePhoneE164Shared,
  phoneDigitsToE164,
} from './otp-normalize';
import { resolveSecret } from '../../config/resolve-secret';
import {
  RegisterCompleteDto,
  RegisterEmailStartDto,
  RegisterEmailVerifyDto,
  RegisterPhoneStartDto,
  RegisterPhoneVerifyDto,
} from './dto/register-flow.dto';

const COMPLETION_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Сколько раз за окно можно запросить OTP на один email/телефон (регистрация). */
const OTP_START_MAX_PER_DESTINATION = 5;
const OTP_START_WINDOW_MS = 15 * 60 * 1000;

export interface RegistrationCompletionJwtPayload {
  purpose: 'register_complete';
  jti: string;
  phone: string | null;
  email: string | null;
  consentPersonalData: boolean;
  consentSms: boolean;
}

/**
 * Гостевая регистрация (OTP → completion JWT → createRetailUser).
 * Shared: OtpChallengeService / otp-normalize / otp-send-errors.
 * Таблица RegistrationChallenge — отдельно от AccountContactChallenge (ЛК).
 */
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
    private readonly rateLimit: AuthRateLimitService,
    private readonly otp: OtpChallengeService,
  ) {}

  private regTokenSecret(): string {
    return (
      this.config.get<string>('REGISTRATION_TOKEN_SECRET')?.trim() ||
      resolveSecret('JWT_SECRET', this.config.get<string>('JWT_SECRET'))
    );
  }

  /** Снижает риск SMS/email bombing по одному destination (DB, multi-instance). */
  private async consumeRegistrationOtpStartSlot(destinationKey: string): Promise<void> {
    await this.rateLimit.consumeSlot(
      `reg_otp:${destinationKey}`,
      OTP_START_MAX_PER_DESTINATION,
      OTP_START_WINDOW_MS,
    );
  }

  /** Нейтральный ответ без OTP — не палим наличие аккаунта и выравниваем тайминг. */
  private async neutralOtpStartResponse(message: string): Promise<{ message: string }> {
    await new Promise((r) => setTimeout(r, 200 + randomInt(0, 300)));
    return { message };
  }

  /** Только цифры страны и абонента, без «+». */
  normalizePhoneE164(raw: string): string {
    return normalizePhoneE164Shared(raw);
  }

  normalizeEmail(raw: string): string {
    return normalizeEmailShared(raw);
  }

  async startPhone(dto: RegisterPhoneStartDto): Promise<{ message: string }> {
    const phone = this.normalizePhoneE164(dto.phone);
    await this.consumeRegistrationOtpStartSlot(`phone:${phone}`);

    const taken = await this.users.existsByPhoneOrEmail(phone, null);
    if (taken) {
      return this.neutralOtpStartResponse('Код отправлен в SMS');
    }

    await this.prisma.registrationChallenge.deleteMany({ where: { phone } });

    const { code, codeHash, expiresAt } = await this.otp.createOtp();

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
      await this.smsOtp.sendSmsOtp(phoneDigitsToE164(phone), code, this.otp.ttlMs / 60000);
    } catch (e) {
      await this.prisma.registrationChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
      this.logger.error(`sendSmsOtp: ${formatSmsSendError(e)}`);
      throw new InternalServerErrorException('Не удалось отправить SMS. Попробуйте позже.');
    }

    return { message: 'Код отправлен в SMS' };
  }

  async startEmail(dto: RegisterEmailStartDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email);
    await this.consumeRegistrationOtpStartSlot(`email:${email}`);

    const taken = await this.users.existsByPhoneOrEmail(null, email);
    if (taken) {
      return this.neutralOtpStartResponse('Код отправлен на email');
    }

    await this.prisma.registrationChallenge.deleteMany({ where: { email } });

    const { code, codeHash, expiresAt } = await this.otp.createOtp();

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

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + COMPLETION_TOKEN_TTL_MS);

    await this.prisma.registrationCompletionToken.create({
      data: {
        id: jti,
        phone: challenge.phone,
        email: challenge.email,
        consentPersonalData: challenge.consentPersonalData,
        consentSms: challenge.consentSms,
        expiresAt,
      },
    });

    const payload: RegistrationCompletionJwtPayload = {
      purpose: 'register_complete',
      jti,
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

    const ok = await this.otp.otpMatches(code, challenge.codeHash);
    if (ok) {
      return this.issueCompletionTokenFromChallenge(challenge);
    }

    return this.otp.rejectWrongCode({
      tryIncrement: () =>
        this.prisma.registrationChallenge.updateMany({
          where: { id: challenge.id, attempts: { lt: this.otp.maxAttempts } },
          data: { attempts: { increment: 1 } },
        }),
      purge: () => this.prisma.registrationChallenge.delete({ where: { id: challenge.id } }),
    });
  }

  private async consumeCompletionToken(jti: string): Promise<void> {
    const consumed = await this.prisma.registrationCompletionToken.updateMany({
      where: {
        id: jti,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Ссылка подтверждения недействительна или истекла');
    }
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

    if (payload.purpose !== 'register_complete' || !payload.jti?.trim()) {
      throw new BadRequestException('Неверный токен регистрации');
    }

    if (!payload.phone && !payload.email) {
      throw new BadRequestException('Неверный токен регистрации');
    }

    await this.consumeCompletionToken(payload.jti);

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
