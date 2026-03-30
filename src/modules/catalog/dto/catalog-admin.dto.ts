import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryAdminDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  /** Обязательно для витрины (категория / подкатегория). */
  @IsString()
  @MinLength(1)
  backgroundImageUrl!: string;

  @IsOptional()
  @IsString()
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  seoDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  seoDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999)
  sortOrder?: number;

  /**
   * Если передано — непустой URL (нельзя сбросить фон).
   * Если не передано — поле не меняется.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  backgroundImageUrl?: string;
}

export class BulkDeleteCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderCategoriesDto {
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MinLength(1)
  parentId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds!: string[];
}
