import { IsString, MinLength, MaxLength, IsBoolean } from 'class-validator';

export class UpdatePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

export class UpdateConsentsDto {
  @IsBoolean()
  consentPersonalData!: boolean;

  @IsBoolean()
  consentSmsMarketing!: boolean;
}
