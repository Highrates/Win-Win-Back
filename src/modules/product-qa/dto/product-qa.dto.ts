import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProductQaAttachmentKind } from '@prisma/client';
import {
  PRODUCT_QA_ATTACHMENTS_MAX,
  PRODUCT_QA_BODY_MAX_CHARS,
  PRODUCT_QA_TOPIC_SLUG_MAX_CHARS,
  PRODUCT_QA_TOPIC_TITLE_MAX_CHARS,
} from '../product-qa.constants';

export class ProductQaAttachmentRefDto {
  @IsString()
  @MaxLength(2048)
  url!: string;

  @IsString()
  @MaxLength(512)
  filename!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;

  @IsOptional()
  @IsEnum(ProductQaAttachmentKind)
  kind?: ProductQaAttachmentKind;
}

export class RevokeProductQaUploadDto {
  @IsString()
  @MaxLength(2048)
  url!: string;
}

export class PostProductQaMessageDto {
  @IsString()
  @MaxLength(PRODUCT_QA_BODY_MAX_CHARS)
  body!: string;

  @IsOptional()
  @IsString()
  productVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_QA_TOPIC_SLUG_MAX_CHARS)
  topicSlug?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_QA_ATTACHMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductQaAttachmentRefDto)
  attachments?: ProductQaAttachmentRefDto[];

  /** Cloudflare Turnstile — обязателен для USER, если задан PRODUCT_QA_TURNSTILE_SECRET_KEY. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}

export class PatchProductQaMessageDto {
  /** Только hide/restore; PENDING — approve/reject, DELETED — POST …/delete. */
  @IsOptional()
  @IsIn(['VISIBLE', 'HIDDEN'])
  status?: 'VISIBLE' | 'HIDDEN';

  /** Редактирование body (staff). Не совмещать со status в одном запросе. */
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_QA_BODY_MAX_CHARS)
  body?: string;
}

export class EditProductQaMessageBodyDto {
  @IsString()
  @MaxLength(PRODUCT_QA_BODY_MAX_CHARS)
  body!: string;
}

export class CreateProductQaTopicDto {
  @IsString()
  @MaxLength(PRODUCT_QA_TOPIC_TITLE_MAX_CHARS)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_QA_TOPIC_SLUG_MAX_CHARS)
  slug?: string;
}

export class PatchProductQaTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_QA_TOPIC_TITLE_MAX_CHARS)
  title?: string;

  @IsOptional()
  sortOrder?: number;
}
