import { IsString, MinLength, MaxLength, IsBoolean } from 'class-validator';
import { IsPasswordPolicy } from '../../auth/password-policy';

export class UpdatePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @IsPasswordPolicy()
  @MaxLength(200)
  newPassword!: string;
}

export class UpdateConsentsDto {
  @IsBoolean()
  consentPersonalData!: boolean;

  @IsBoolean()
  consentSmsMarketing!: boolean;
}
