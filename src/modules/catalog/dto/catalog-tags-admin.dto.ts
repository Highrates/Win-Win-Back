import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCatalogTagAdminDto {
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
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  coverMediaObjectId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdateCatalogTagAdminDto {
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
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  productIds?: string[];
}

export class BulkDeleteCatalogTagsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

export class ReorderCatalogTagsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds!: string[];
}
