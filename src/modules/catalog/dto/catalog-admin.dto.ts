import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
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

  /** Обложка (необязательно при создании). */
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  backgroundImageUrl?: string | null;

  /** Если обложка из медиатеки — id объекта. */
  @IsOptional()
  @IsString()
  backgroundMediaObjectId?: string;

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

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  backgroundImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  backgroundMediaObjectId?: string | null;
}

export class BulkDeleteCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class BulkDeleteBrandsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class BulkDeleteProductsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class CreateBrandAdminDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  slug?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  galleryImageUrls?: string[];

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  shortDescription?: string | null;

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

export class UpdateBrandAdminDto {
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
  coverImageUrl?: string | null;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  galleryImageUrls?: string[];

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  shortDescription?: string | null;

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

export class ProductGalleryItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  alt?: string | null;
}

/* ------------------------------------------------------------------ *
 *  Brand materials / colors (библиотека материалов бренда)
 * ------------------------------------------------------------------ */

export class UpsertBrandMaterialColorDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(2048)
  imageUrl?: string | null;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class UpsertBrandMaterialDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpsertBrandMaterialColorDto)
  colors!: UpsertBrandMaterialColorDto[];
}

export class UpdateBrandMaterialsAdminDto {
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => UpsertBrandMaterialDto)
  materials!: UpsertBrandMaterialDto[];
}

/* ------------------------------------------------------------------ *
 *  Модификации / элементы товара
 * ------------------------------------------------------------------ */

export class UpsertProductModificationDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modificationSlug?: string | null;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

/** Пересобрать модификации товара целиком (id → сохранить, без id → создать, отсутствующие — удалить). */
export class UpdateProductModificationsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => UpsertProductModificationDto)
  modifications!: UpsertProductModificationDto[];
}

export class UpsertProductElementAvailabilityDto {
  @IsString()
  @MinLength(1)
  brandMaterialColorId!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class UpsertProductElementDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  /** Пул «материал-цветов» бренда, доступных для выбора в варианте. */
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => UpsertProductElementAvailabilityDto)
  availabilities!: UpsertProductElementAvailabilityDto[];
}

export class UpdateProductElementsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => UpsertProductElementDto)
  elements!: UpsertProductElementDto[];
}

/* ------------------------------------------------------------------ *
 *  Товар (без размеров/материалов/цветов — всё через модификации)
 * ------------------------------------------------------------------ */

export class CreateProductAdminDto {
  @IsString()
  @MinLength(1)
  categoryId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  additionalCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  curatedCollectionIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  curatedProductSetIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MinLength(1)
  brandId?: string | null;

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
  @MaxLength(100000)
  shortDescription?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductGalleryItemDto)
  gallery?: ProductGalleryItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  deliveryText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  technicalSpecs?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  additionalInfoHtml?: string | null;

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
}

/** PATCH общих полей товара (без вариантов/модификаций — для них отдельные ручки). */
export class UpdateProductShellAdminDto {
  @IsString()
  @MinLength(1)
  categoryId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  additionalCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  curatedCollectionIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  curatedProductSetIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @MinLength(1)
  brandId?: string | null;

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
  @MaxLength(100000)
  shortDescription?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductGalleryItemDto)
  gallery?: ProductGalleryItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  deliveryText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  technicalSpecs?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500000)
  additionalInfoHtml?: string | null;

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
}

/* ------------------------------------------------------------------ *
 *  Варианты товара (Модификация + selection «элемент → brandMaterialColor»)
 * ------------------------------------------------------------------ */

export class VariantElementSelectionDto {
  @IsString()
  @MinLength(1)
  productElementId!: string;

  @IsString()
  @MinLength(1)
  brandMaterialColorId!: string;
}

export class CreateProductVariantAdminDto {
  @IsString()
  @MinLength(1)
  modificationId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => VariantElementSelectionDto)
  selections?: VariantElementSelectionDto[];
}

/** PATCH варианта — все бизнес-поля. */
export class UpdateProductVariantAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  variantLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  variantSlug?: string | null;

  @IsOptional()
  @IsString()
  modificationId?: string;

  /** Полный список selection (по одной строке на элемент модификации). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => VariantElementSelectionDto)
  selections?: VariantElementSelectionDto[];

  /** Кадры варианта — подмножество ProductImage (по id). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  galleryProductImageIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  lengthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  widthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  heightMm?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  volumeLiters?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  netLengthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  netWidthMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  netHeightMm?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netVolumeLiters?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netWeightKg?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  model3dUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  drawingUrl?: string | null;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  @IsIn(['manual', 'formula'])
  priceMode?: 'manual' | 'formula';

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPriceCny?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
