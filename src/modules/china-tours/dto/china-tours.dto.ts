import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ChinaTourApplicationStatus,
  ChinaTourImageRole,
  ChinaTourReviewStatus,
} from '@prisma/client';

export class ChinaTourScheduleItemDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(32) timeLabel!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(50000) body!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ChinaTourImageDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) url!: string;
  @IsEnum(ChinaTourImageRole) role!: ChinaTourImageRole;
  @IsOptional() @IsString() dayId?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ChinaTourDayDto {
  @IsOptional() @IsString() id?: string;
  @IsInt() @Min(1) dayNumber!: number;
  @IsString() @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourScheduleItemDto)
  items?: ChinaTourScheduleItemDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourImageDto)
  images?: ChinaTourImageDto[];
}

export class CreateChinaTourDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) cardText?: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) seatsTotal?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) seatsTaken?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourDayDto)
  days?: ChinaTourDayDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourImageDto)
  images?: ChinaTourImageDto[];
}

export class UpdateChinaTourDto {
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) cardText?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) seatsTotal?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) seatsTaken?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourDayDto)
  days?: ChinaTourDayDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChinaTourImageDto)
  images?: ChinaTourImageDto[];
}

export class UpdateChinaToursLandingDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(16000) description?: string;
  @IsOptional() @IsString() imageUrl?: string | null;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featuredTourIds?: string[];
}

export class ReorderChinaToursDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class CreateChinaTourApplicationDto {
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}

export class PatchChinaTourApplicationStatusDto {
  @IsEnum(ChinaTourApplicationStatus) status!: ChinaTourApplicationStatus;
}

export class CreateChinaTourReviewDto {
  @IsString() @MinLength(2) @MaxLength(4000) body!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
}

export class PatchChinaTourReviewStatusDto {
  @IsEnum(ChinaTourReviewStatus) status!: ChinaTourReviewStatus;
}
