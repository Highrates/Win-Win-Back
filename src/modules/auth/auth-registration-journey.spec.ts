/**
 * Полный guest journey: email OTP start → verify → complete → password-reset request → confirm.
 * Моки Prisma / mail / rate-limit; реальный OtpChallengeService + JwtService.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegistrationService } from './registration.service';
import { PasswordResetService } from './password-reset.service';
import { OtpChallengeService } from './otp-challenge.service';

const JWT_SECRET = 'journey-test-secret';
const OTP_CODE = '424242';

describe('auth registration → reset journey', () => {
  let otp: OtpChallengeService;
  let jwt: JwtService;
  let registrationChallenge: {
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  let registrationCompletionToken: {
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  let passwordResetToken: {
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  let users: {
    existsByPhoneOrEmail: ReturnType<typeof vi.fn>;
    createRetailUser: ReturnType<typeof vi.fn>;
    setPasswordWithoutCurrent: ReturnType<typeof vi.fn>;
  };
  let mail: {
    sendRegistrationOtp: ReturnType<typeof vi.fn>;
    sendPasswordResetLink: ReturnType<typeof vi.fn>;
  };
  let registration: RegistrationService;
  let passwordReset: PasswordResetService;
  let codeHash: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    otp = new OtpChallengeService();
    jwt = new JwtService({ secret: JWT_SECRET });
    codeHash = await bcrypt.hash(OTP_CODE, 8);

    registrationChallenge = {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 'ch1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    };
    registrationCompletionToken = {
      create: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    passwordResetToken = {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };

    const prisma = {
      registrationChallenge,
      registrationCompletionToken,
      passwordResetToken,
      user: {
        findFirst: vi.fn(),
      },
    };

    users = {
      existsByPhoneOrEmail: vi.fn().mockResolvedValue(false),
      createRetailUser: vi.fn().mockResolvedValue({
        user: { id: 'u1', email: 'journey@example.com', phone: null, role: 'USER' },
        referralWarning: null,
      }),
      setPasswordWithoutCurrent: vi.fn().mockResolvedValue({ ok: true }),
    };
    mail = {
      sendRegistrationOtp: vi.fn().mockResolvedValue(undefined),
      sendPasswordResetLink: vi.fn().mockResolvedValue(undefined),
    };
    const rateLimit = { consumeSlot: vi.fn().mockResolvedValue(undefined) };
    const designerInvites = { assertValidForNewAccountEmail: vi.fn().mockResolvedValue(null) };
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'JWT_SECRET') return JWT_SECRET;
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      }),
    };

    vi.spyOn(otp, 'createOtp').mockResolvedValue({
      code: OTP_CODE,
      codeHash,
      expiresAt: new Date(Date.now() + 600_000),
    });

    registration = new RegistrationService(
      prisma as never,
      users as never,
      mail as never,
      { sendSmsOtp: vi.fn() } as never,
      jwt,
      config as never,
      designerInvites as never,
      rateLimit as never,
      otp,
    );

    passwordReset = new PasswordResetService(
      prisma as never,
      config as never,
      jwt,
      mail as never,
      users as never,
    );

    // password-reset looks up USER after register
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async (args: {
      where?: { email?: string; id?: string; role?: string };
    }) => {
      const email = args.where?.email ?? 'journey@example.com';
      if (args.where?.id === 'u1' || email === 'journey@example.com') {
        return {
          id: 'u1',
          email: 'journey@example.com',
          passwordHash: 'hash',
          role: 'USER',
          isActive: true,
        };
      }
      return null;
    });
  });

  it('OTP start → verify → complete → password reset confirm', async () => {
    const start = await registration.startEmail({
      email: 'journey@example.com',
      consentPersonalData: true,
      consentSms: false,
    });
    expect(start.message).toMatch(/код/i);
    expect(mail.sendRegistrationOtp).toHaveBeenCalled();
    expect(registrationChallenge.create).toHaveBeenCalled();

    registrationChallenge.findFirst.mockResolvedValue({
      id: 'ch1',
      phone: null,
      email: 'journey@example.com',
      codeHash,
      attempts: 0,
      consentPersonalData: true,
      consentSms: false,
    });

    const verified = await registration.verifyEmail({
      email: 'journey@example.com',
      code: OTP_CODE,
    });
    expect(verified.completionToken).toBeTruthy();
    expect(registrationCompletionToken.create).toHaveBeenCalled();

    const completed = await registration.complete({
      completionToken: verified.completionToken,
      password: 'Password1!',
    });
    expect(users.createRetailUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'journey@example.com',
        password: 'Password1!',
      }),
    );
    expect(completed.user.id).toBe('u1');

    const resetReq = await passwordReset.requestReset('journey@example.com');
    expect(resetReq.sent).toBe(true);
    expect(mail.sendPasswordResetLink).toHaveBeenCalled();
    expect(passwordResetToken.create).toHaveBeenCalled();

    const resetLink = (mail.sendPasswordResetLink as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .resetLink as string;
    const token = new URL(resetLink).searchParams.get('t');
    expect(token).toBeTruthy();

    const createdJti = (passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .data.id as string;
    passwordResetToken.findFirst.mockResolvedValue({ id: createdJti });

    const verify = await passwordReset.verifyToken(token!);
    expect(verify.valid).toBe(true);
    expect(verify.email).toBe('journey@example.com');

    const confirmed = await passwordReset.confirmReset(token!, 'NewPass99');
    expect(confirmed.ok).toBe(true);
    expect(users.setPasswordWithoutCurrent).toHaveBeenCalledWith('u1', 'NewPass99');
    expect(passwordResetToken.updateMany).toHaveBeenCalled();
  });
});
