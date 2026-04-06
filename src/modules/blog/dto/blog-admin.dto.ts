import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateBlogCategoryAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBlogCategoryAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateBlogPostAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  excerpt?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  /** Дата статьи (на витрине / для сортировки). По умолчанию — сейчас. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  publishedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverUrl?: string | null;
}

export class UpdateBlogPostAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(40)
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(4000)
  excerpt?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsISO8601()
  publishedAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2000)
  coverUrl?: string | null;
}

export class BulkIdsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

export class BulkSetPublishedDto extends BulkIdsDto {
  @IsBoolean()
  isPublished!: boolean;
}

export class ReorderBlogPostsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  orderedIds!: string[];
}
