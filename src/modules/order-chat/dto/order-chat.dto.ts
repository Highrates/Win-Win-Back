import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChatAttachmentKind } from '@prisma/client';

export class OrderChatAttachmentRefDto {
  @IsString()
  @MaxLength(2048)
  fileUrl!: string;

  @IsString()
  @MaxLength(512)
  filename!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @IsEnum(ChatAttachmentKind)
  kind!: ChatAttachmentKind;
}

export class PostOrderChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => OrderChatAttachmentRefDto)
  attachments?: OrderChatAttachmentRefDto[];
}
