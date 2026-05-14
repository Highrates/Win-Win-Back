import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CommercialProposalLineInputDto {
  @IsOptional()
  @IsString()
  sourceOrderItemId?: string | null;

  @IsNumber()
  @Min(0)
  sortOrder!: number;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  productVariantId?: string | null;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsString()
  unit!: string;

  @IsOptional()
  snapshot?: Record<string, unknown>;

  @IsNumber()
  @Min(0)
  offerUnitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number | null;

  @IsOptional()
  @IsString()
  deliveryEta?: string | null;

  @IsOptional()
  @IsString()
  lineNote?: string | null;
}

export class UpdateCommercialProposalDraftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommercialProposalLineInputDto)
  lines!: CommercialProposalLineInputDto[];
}

export class InitCommercialProposalDraftDto {
  @IsOptional()
  @IsString()
  fromPublishedProposalId?: string;
}

/** После «На согласовании» допустимые статусы при публикации КП. */
export class PublishCommercialProposalDto {
  @IsOptional()
  @IsIn(['ORDERED', 'PAID', 'RECEIVED'])
  nextOrderStatus?: 'ORDERED' | 'PAID' | 'RECEIVED';
}
