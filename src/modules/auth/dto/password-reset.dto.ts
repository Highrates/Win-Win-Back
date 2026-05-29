import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;
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
  @MinLength(8)
  password!: string;
}
