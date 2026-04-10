import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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

  /**
   * Обложка: непустой URL, или null чтобы убрать.
   * Не передавайте поле, если не меняете.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  backgroundImageUrl?: string | null;

  /** Вместе с непустым backgroundImageUrl — связь с MediaObject; null при снятии обложки. */
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
  /** Сохранение id при PATCH — чтобы ссылки вариантов на кадры не ломались. */
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

/** Цвет внутри материала на карточке товара. */
export class ProductColorOptionShellDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

/** Материал и вложенные цвета (заводятся на товаре, в варианте — выбор). */
export class ProductMaterialOptionShellDto {
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
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ProductColorOptionShellDto)
  colors!: ProductColorOptionShellDto[];
}

export class ProductColorSpecDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl!: string;
}

export class ProductMaterialSpecDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class ProductSizeSpecDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value!: string;
}

export class CreateProductAdminDto {
  @IsString()
  @MinLength(1)
  categoryId!: string;

  /** Дополнительные категории (основная — categoryId). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  additionalCategoryIds?: string[];

  /** Коллекции типа «товары», в которых состоит товар. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  curatedCollectionIds?: string[];

  /** Наборы, в которых состоит товар. */
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
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ProductColorSpecDto)
  colors?: ProductColorSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductMaterialSpecDto)
  materials?: ProductMaterialSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductSizeSpecDto)
  sizes?: ProductSizeSpecDto[];

  /** Материалы и цвета на карточке товара; сочетание материал+цвет для SKU задаётся в варианте. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductMaterialOptionShellDto)
  materialColorOptions?: ProductMaterialOptionShellDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  labels?: string[];

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

  /** URL 3D-модели (медиатека / своё хранилище). */
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  model3dUrl?: string | null;

  /** URL чертежа (PDF и т.п.). */
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  drawingUrl?: string | null;

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

  /** Объём брутто в м³ (задаётся вручную в админке). */
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

  /** Объём нетто в м³ (вручную). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  netVolumeLiters?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netWeightKg?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  seoDescription?: string | null;

  /** Цена дефолтного варианта; по умолчанию 0 — задаётся в карточке варианта. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

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

/** PATCH товара: общие поля без варианта (цена, SKU, габариты — в варианте). */
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

  /** Материалы и цвета для витрины; при отсутствии поля — не менять. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductMaterialOptionShellDto)
  materialColorOptions?: ProductMaterialOptionShellDto[];
}

/** PATCH варианта товара. */
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
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  materialOptionId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  colorOptionId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  galleryProductImageIds?: string[];

  @IsOptional()
  @IsObject()
  optionAttributes?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductGalleryItemDto)
  gallery?: ProductGalleryItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ProductColorSpecDto)
  colors?: ProductColorSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductMaterialSpecDto)
  materials?: ProductMaterialSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ProductSizeSpecDto)
  sizes?: ProductSizeSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  labels?: string[];

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
