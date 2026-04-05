import { IsString, MinLength } from 'class-validator';

export class PurgeAuditJournalDto {
  @IsString()
  @MinLength(1, { message: 'password is required' })
  password!: string;
}
