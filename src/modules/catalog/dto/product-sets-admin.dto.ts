import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateProductSetAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MinLength(1)
  brandId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  coverMediaObjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  seoDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Порядок = порядок в массиве. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdateProductSetAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  brandId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  coverImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  coverMediaObjectId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  seoDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  productIds?: string[];
}

export class BulkDeleteProductSetsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}
