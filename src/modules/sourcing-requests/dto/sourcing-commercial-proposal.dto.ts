import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SourcingCommercialProposalLineInputDto {
  @IsOptional()
  @IsString()
  sourceSourcingRequestItemId?: string;

  @IsInt()
  sortOrder!: number;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  unit!: string;

  @IsNumber()
  @Min(0)
  costPriceCny!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  grossWeightKg?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  volumeM3?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offerUnitPrice?: number;

  @IsOptional()
  @IsString()
  deliveryEta?: string | null;
}

export class UpdateSourcingCommercialProposalDraftDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => SourcingCommercialProposalLineInputDto)
  lines!: SourcingCommercialProposalLineInputDto[];
}

export class InitSourcingCommercialProposalDraftDto {
  @IsOptional()
  @IsString()
  fromPublishedProposalId?: string;
}
