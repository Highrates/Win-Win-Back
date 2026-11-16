import {
  CuratedCollectionKind,
  CuratedHomeGridSize,
  CuratedHomeOrderMode,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCuratedCollectionAdminDto {
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

  @IsEnum(CuratedCollectionKind)
  kind!: CuratedCollectionKind;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** PRODUCT only: на главную. */
  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  homeOrder?: number | null;

  @IsOptional()
  @IsEnum(CuratedHomeGridSize)
  homeGridSize?: CuratedHomeGridSize;

  @IsOptional()
  @IsEnum(CuratedHomeOrderMode)
  homeOrderMode?: CuratedHomeOrderMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  homePriceMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  homePriceMax?: number | null;

  /** Порядок = порядок в массиве. Только при kind PRODUCT. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  productIds?: string[];

  /** Порядок = порядок в массиве. Только при kind BRAND. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  brandIds?: string[];
}

export class UpdateCuratedCollectionAdminDto {
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
  coverImageUrl?: string | null;

  /** null — снять обложку */
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
  @IsEnum(CuratedCollectionKind)
  kind?: CuratedCollectionKind;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  homeOrder?: number | null;

  @IsOptional()
  @IsEnum(CuratedHomeGridSize)
  homeGridSize?: CuratedHomeGridSize;

  @IsOptional()
  @IsEnum(CuratedHomeOrderMode)
  homeOrderMode?: CuratedHomeOrderMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  homePriceMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  homePriceMax?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  brandIds?: string[];
}

export class BulkDeleteCuratedCollectionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderCuratedCollectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds!: string[];
}
