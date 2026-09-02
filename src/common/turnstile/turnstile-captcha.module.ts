import { Global, Module } from '@nestjs/common';
import { TurnstileCaptchaService } from './turnstile-captcha.service';

@Global()
@Module({
  providers: [TurnstileCaptchaService],
  exports: [TurnstileCaptchaService],
})
export class TurnstileCaptchaModule {}
