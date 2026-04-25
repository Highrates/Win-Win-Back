import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength, MaxLength, Equals } from 'class-validator';

export class RegisterPhoneStartDto {
  @IsString()
  @MinLength(8)
  /** E.164, например +79001234567 */
  phone!: string;

  @IsBoolean()
  @Equals(true, { message: 'Необходимо согласие на обработку персональных данных' })
  consentPersonalData!: boolean;

  @IsBoolean()
  consentSms!: boolean;
}

export class RegisterEmailStartDto {
  @IsEmail()
  email!: string;

  @IsBoolean()
  @Equals(true, { message: 'Необходимо согласие на обработку персональных данных' })
  consentPersonalData!: boolean;

  @IsBoolean()
  consentSms!: boolean;
}

export class RegisterPhoneVerifyDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Код должен состоять из 6 цифр' })
  code!: string;
}

export class RegisterEmailVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Код должен состоять из 6 цифр' })
  code!: string;
}

export class RegisterCompleteDto {
  @IsString()
  @MinLength(20)
  completionToken!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Публичный реф. номер Win-Win (из ссылки ?ref=); L1 / L2 — см. UsersService.createRetailUser. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralCode?: string;

  /** JWT приглашения дизайнера (из письма); ref берётся из БД, не из URL. */
  @IsOptional()
  @IsString()
  @MaxLength(90000)
  designerInviteToken?: string;
}
