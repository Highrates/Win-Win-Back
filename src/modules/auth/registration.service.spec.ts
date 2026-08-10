import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { RegistrationService } from './registration.service';

function makeService(overrides?: {
  existsByPhoneOrEmail?: (phone: string | null, email: string | null) => Promise<boolean>;
  prisma?: Partial<Record<string, unknown>>;
}) {
  const prisma = {
    registrationChallenge: {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    registrationCompletionToken: {
      create: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides?.prisma,
  };

  const users = {
    existsByPhoneOrEmail: vi
      .fn()
      .mockImplementation(overrides?.existsByPhoneOrEmail ?? (async () => false)),
    createRetailUser: vi.fn().mockResolvedValue({ user: { id: 'u1' }, referralWarning: null }),
  };

  const mail = { sendRegistrationOtp: vi.fn().mockResolvedValue(undefined) };
  const smsOtp = { sendSmsOtp: vi.fn().mockResolvedValue(undefined) };
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('completion-jwt'),
    verifyAsync: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined)),
  };
  const designerInvites = {
    assertValidForNewAccountEmail: vi.fn(),
  };

  const service = new RegistrationService(
    prisma as never,
    users as never,
    mail as never,
    smsOtp as never,
    jwt as never,
    config as never,
    designerInvites as never,
  );

  return { service, prisma, users, mail, smsOtp, jwt };
}

describe('RegistrationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('startPhone', () => {
    it('returns neutral message without sending SMS when phone is taken', async () => {
      const { service, smsOtp, prisma } = makeService({
        existsByPhoneOrEmail: async () => true,
      });

      const res = await service.startPhone({
        phone: '+79001234567',
        consentPersonalData: true,
        consentSms: true,
      });

      expect(res.message).toBe('Код отправлен в SMS');
      expect(smsOtp.sendSmsOtp).not.toHaveBeenCalled();
      expect(prisma.registrationChallenge.create).not.toHaveBeenCalled();
    });

    it('does not leak SMS provider details on send failure', async () => {
      const { service, smsOtp, prisma } = makeService();
      prisma.registrationChallenge.create.mockResolvedValue({ id: 'ch1' });
      smsOtp.sendSmsOtp.mockRejectedValue(new Error('provider secret error'));

      await expect(
        service.startPhone({
          phone: '+79001234567',
          consentPersonalData: true,
          consentSms: true,
        }),
      ).rejects.toMatchObject({
        response: { message: 'Не удалось отправить SMS. Попробуйте позже.' },
      });
      expect(prisma.registrationChallenge.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
    });

    it('rate-limits OTP starts per destination', async () => {
      const { service, prisma } = makeService();
      prisma.registrationChallenge.create.mockResolvedValue({ id: 'ch1' });
      const dto = { phone: '+79001234567', consentPersonalData: true, consentSms: true };

      for (let i = 0; i < 5; i += 1) {
        await service.startPhone(dto);
      }

      await expect(service.startPhone(dto)).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('startEmail', () => {
    it('returns neutral message without sending email when address is taken', async () => {
      const { service, mail, prisma } = makeService({
        existsByPhoneOrEmail: async (_p, email) => !!email,
      });

      const res = await service.startEmail({
        email: 'taken@example.com',
        consentPersonalData: true,
        consentSms: false,
      });

      expect(res.message).toBe('Код отправлен на email');
      expect(mail.sendRegistrationOtp).not.toHaveBeenCalled();
      expect(prisma.registrationChallenge.create).not.toHaveBeenCalled();
    });
  });

  describe('finishVerify (via verifyPhone)', () => {
    it('increments attempts atomically and rejects after max wrong tries', async () => {
      const challenge = {
        id: 'ch1',
        phone: '79001234567',
        email: null,
        codeHash: await bcrypt.hash('000000', 8),
        attempts: 4,
        consentPersonalData: true,
        consentSms: true,
      };
      const { service, prisma } = makeService();
      prisma.registrationChallenge.findFirst.mockResolvedValue(challenge);
      prisma.registrationChallenge.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(
        service.verifyPhone({ phone: '+79001234567', code: '111111' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.verifyPhone({ phone: '+79001234567', code: '111111' }),
      ).rejects.toMatchObject({
        response: { message: 'Превышено число попыток. Запросите код заново.' },
      });

      expect(prisma.registrationChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'ch1', attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('issues completion token with jti stored in DB', async () => {
      const code = '123456';
      const challenge = {
        id: 'ch1',
        phone: '79001234567',
        email: null,
        codeHash: await bcrypt.hash(code, 8),
        attempts: 0,
        consentPersonalData: true,
        consentSms: true,
      };
      const { service, prisma, jwt } = makeService();
      prisma.registrationChallenge.findFirst.mockResolvedValue(challenge);

      const res = await service.verifyPhone({ phone: '+79001234567', code });

      expect(res.completionToken).toBe('completion-jwt');
      expect(prisma.registrationCompletionToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '79001234567',
            email: null,
          }),
        }),
      );
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'register_complete', jti: expect.any(String) }),
        expect.any(Object),
      );
    });
  });

  describe('complete', () => {
    it('rejects replay when completion token already consumed', async () => {
      const { service, jwt, prisma } = makeService();
      jwt.verifyAsync.mockResolvedValue({
        purpose: 'register_complete',
        jti: 'token-id',
        phone: '79001234567',
        email: null,
        consentPersonalData: true,
        consentSms: true,
        sub: 'register-complete',
      });
      prisma.registrationCompletionToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.complete({ completionToken: 'jwt', password: 'Password1!' }),
      ).rejects.toMatchObject({
        response: { message: 'Ссылка подтверждения недействительна или истекла' },
      });
    });
  });
});
