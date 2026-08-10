import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PostProductQaMessageDto, EditProductQaMessageBodyDto } from '../../product-qa/dto/product-qa.dto';

export { EditProductQaMessageBodyDto as EditProductCorrespondenceMessageBodyDto };

export class PostProductCorrespondenceMessageDto extends PostProductQaMessageDto {
  /** Только staff: ID покупателя в переписке 1:1. */
  @IsOptional()
  @IsString()
  customerUserId?: string;
}

export class PublishCorrespondenceToQaDto {
  @IsOptional()
  topicSlug?: string;
}

export class PublishCorrespondencePairToQaDto {
  @IsString()
  questionMessageId!: string;

  @IsString()
  answerMessageId!: string;

  @IsOptional()
  topicSlug?: string;
}
