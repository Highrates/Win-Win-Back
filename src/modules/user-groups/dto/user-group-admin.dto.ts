import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertUserGroupAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  referralProgramProfileId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  designerBonusProfileId?: string;

  /** Профиль ценообразования (фаза 3 на витрине); null — сбросить. */
  @IsOptional()
  @IsString()
  pricingProfileId?: string | null;
}

export class AddUserGroupMemberAdminDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}

export class SetUserGroupMembershipAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  groupId?: string | null;
}
