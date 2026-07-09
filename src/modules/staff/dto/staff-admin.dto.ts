import { MODERATOR_ASSIGNABLE_SECTIONS, type ModeratorAssignableSectionId } from '@win-win/admin-sections';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const ASSIGNABLE_SECTION_VALUES = [...MODERATOR_ASSIGNABLE_SECTIONS];

export class CreateStaffAdminDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  staffDisplayName?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ASSIGNABLE_SECTION_VALUES, {
    each: true,
    message: `adminSections: допустимые значения — ${ASSIGNABLE_SECTION_VALUES.join(', ')}`,
  })
  adminSections!: ModeratorAssignableSectionId[];
}

export class UpdateStaffAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  staffDisplayName?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ASSIGNABLE_SECTION_VALUES, {
    each: true,
    message: `adminSections: допустимые значения — ${ASSIGNABLE_SECTION_VALUES.join(', ')}`,
  })
  adminSections?: ModeratorAssignableSectionId[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
