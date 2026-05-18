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
import {
  ORDER_CHAT_ATTACHMENTS_MAX,
  ORDER_CHAT_POST_BODY_MAX_CHARS,
} from '../order-chat.constants';

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
  @MaxLength(ORDER_CHAT_POST_BODY_MAX_CHARS)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ORDER_CHAT_ATTACHMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => OrderChatAttachmentRefDto)
  attachments?: OrderChatAttachmentRefDto[];
}
