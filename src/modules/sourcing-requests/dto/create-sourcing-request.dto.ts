import { BadRequestException } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  validateSync,
  type ValidationError,
} from 'class-validator';
import {
  SOURCING_BUDGET_MAX,
  SOURCING_CITY_MAX,
  SOURCING_FILE_KEY_MAX,
  SOURCING_MAX_ATTACHMENT_KEYS,
  SOURCING_MAX_PRODUCTS,
  SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT,
  SOURCING_PRODUCT_FIELD_MAX,
  SOURCING_PRODUCT_DESCRIPTION_MAX,
  SOURCING_PRODUCT_LINK_MAX,
  SOURCING_PRODUCT_NAME_MAX,
  SOURCING_TITLE_MAX,
  SOURCING_UNIT_OPTIONS,
} from '../sourcing-limits.constants';
import { isProductMinimallyFilled, isSoftValidProductLink } from '@win-win/sourcing-request';

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimOptionalString(value: unknown): string | undefined {
  const trimmed = trimString(value);
  return trimmed || undefined;
}

function flattenValidationErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const err of errors) {
    if (err.constraints) {
      out.push(...Object.values(err.constraints));
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children));
    }
  }
  return out;
}

export class CreateSourcingRequestProductDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_NAME_MAX)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_LINK_MAX)
  productLink?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_FIELD_MAX)
  material?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_FIELD_MAX)
  color?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_FIELD_MAX)
  size?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_PRODUCT_DESCRIPTION_MAX)
  description?: string;

  @Transform(({ value }) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return 1;
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999_999)
  quantity!: number;

  @Transform(({ value }) => {
    if (value === undefined || value === null) return 'шт';
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : 'шт';
  })
  @IsString()
  @IsIn([...SOURCING_UNIT_OPTIONS], { message: 'Единица измерения должна быть из списка' })
  unit!: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_BUDGET_MAX)
  expectedBudget?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      : [],
  )
  @IsArray()
  @ArrayMaxSize(SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT)
  @IsString({ each: true })
  @MaxLength(SOURCING_FILE_KEY_MAX, { each: true })
  referenceImageKeys: string[] = [];
}

export class CreateSourcingRequestDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(SOURCING_TITLE_MAX)
  title!: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @MaxLength(SOURCING_CITY_MAX)
  deliveryCity?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SOURCING_MAX_PRODUCTS)
  @ValidateNested({ each: true })
  @Type(() => CreateSourcingRequestProductDto)
  products!: CreateSourcingRequestProductDto[];

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      : [],
  )
  @IsArray()
  @ArrayMaxSize(SOURCING_MAX_ATTACHMENT_KEYS)
  @IsString({ each: true })
  @MaxLength(SOURCING_FILE_KEY_MAX, { each: true })
  attachmentKeys: string[] = [];
}

export type CreateSourcingRequestProductPayload = CreateSourcingRequestProductDto;
export type CreateSourcingRequestPayload = CreateSourcingRequestDto;

export function parseCreateSourcingRequestPayload(raw: string): CreateSourcingRequestDto {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('Некорректный JSON в поле payload');
  }

  const dto = plainToInstance(CreateSourcingRequestDto, parsed);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    const messages = flattenValidationErrors(errors);
    throw new BadRequestException(messages.length ? messages : 'Некорректный payload');
  }

  dto.products.forEach((product, index) => {
    if (
      !isProductMinimallyFilled({
        name: product.name,
        description: product.description,
        productLink: product.productLink,
        referenceCount: product.referenceImageKeys?.length ?? 0,
      })
    ) {
      throw new BadRequestException(
        `Товар ${index + 1}: укажите название, описание, ссылку или референс`,
      );
    }
    if (product.productLink && !isSoftValidProductLink(product.productLink)) {
      throw new BadRequestException(`Товар ${index + 1}: проверьте адрес ссылки`);
    }
  });

  return dto;
}
