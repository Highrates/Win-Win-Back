import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class SendDesignerInviteDto {
  @IsEmail()
  email!: string;
}

export class DesignerInviteTokenBodyDto {
  @IsString()
  @MinLength(20)
  @MaxLength(64_000)
  token!: string;
}
