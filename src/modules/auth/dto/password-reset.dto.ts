import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsPasswordPolicy } from '../password-policy';

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  turnstileToken?: string;
}

export class PasswordResetTokenBodyDto {
  @IsString()
  @MinLength(20)
  @MaxLength(90000)
  token!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(20)
  @MaxLength(90000)
  token!: string;

  @IsString()
  @IsPasswordPolicy()
  password!: string;
}
