import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStaffSelfDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  staffDisplayName?: string | null;
}
