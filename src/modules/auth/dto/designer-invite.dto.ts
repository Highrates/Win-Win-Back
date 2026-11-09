import { IsBoolean, IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class SendDesignerInviteDto {
  @IsEmail()
  email!: string;

  /** Подтверждение отправки при предупреждении о получателе (уже в команде / структуре). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class DesignerInviteTokenBodyDto {
  @IsString()
  @MinLength(20)
  @MaxLength(64_000)
  token!: string;
}
