import { IsString, MinLength, MaxLength, Matches, IsNotEmpty } from 'class-validator';

const OTP_RE = /^\d{6}$/;

export class AccountContactEmailStartDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  email!: string;
}

export class AccountContactEmailVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  email!: string;

  @IsString()
  @Matches(OTP_RE, { message: 'Код — 6 цифр' })
  code!: string;
}

export class AccountContactPhoneStartDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(32)
  phone!: string;
}

export class AccountContactPhoneVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(32)
  phone!: string;

  @IsString()
  @Matches(OTP_RE, { message: 'Код — 6 цифр' })
  code!: string;
}
