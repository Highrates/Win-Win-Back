import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolveSecret } from '../../config/resolve-secret';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { MailService } from './mail.service';
import { UnimtxOtpService } from './unimtx-otp.service';
import { RegistrationService } from './registration.service';
import { AccountContactService } from './account-contact.service';
import { DesignerInviteService } from './designer-invite.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { PasswordResetService } from './password-reset.service';
import { OtpChallengeService } from './otp-challenge.service';
import { InviteClaimService } from './invite-claim.service';
@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: resolveSecret('JWT_SECRET', config.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    MailService,
    UnimtxOtpService,
    AuthRateLimitService,
    OtpChallengeService,
    RegistrationService,
    AccountContactService,
    DesignerInviteService,
    InviteClaimService,
    PasswordResetService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AccountContactService, DesignerInviteService, InviteClaimService, MailService, JwtModule],
})
export class AuthModule {}
