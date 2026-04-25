import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { MailService } from './mail.service';
import { UnimtxOtpService } from './unimtx-otp.service';
import { RegistrationService } from './registration.service';
import { AccountContactService } from './account-contact.service';
import { DesignerInviteService } from './designer-invite.service';
@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'dev-secret'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, MailService, UnimtxOtpService, RegistrationService, AccountContactService, DesignerInviteService],
  controllers: [AuthController],
  exports: [AuthService, AccountContactService, DesignerInviteService, MailService],
})
export class AuthModule {}
