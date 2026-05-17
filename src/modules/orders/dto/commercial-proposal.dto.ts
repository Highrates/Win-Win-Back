import { KP_PUBLISH_NEXT_STATUSES } from '@win-win/order-status';
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

export class PublishCommercialProposalDto {
  @IsOptional()
  @IsIn(KP_PUBLISH_NEXT_STATUSES)
  nextOrderStatus?: (typeof KP_PUBLISH_NEXT_STATUSES)[number];
}
