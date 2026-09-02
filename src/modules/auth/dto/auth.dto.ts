import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  emailOrPhone: string;

  @IsString()
  password: string;

  /** Cloudflare Turnstile — обязателен, если задан TURNSTILE_SECRET_KEY / PRODUCT_QA_TURNSTILE_SECRET_KEY. */
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
