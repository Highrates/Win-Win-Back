import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpsertPricingProfileAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  setAsPrimary?: boolean;

  @IsString()
  @IsIn(['40', '20'])
  containerType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  containerMaxWeightKg?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  containerMaxVolumeM3?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cnyRate!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  usdRate!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  eurRate!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transferCommissionPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsAdValoremPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsWeightPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vatPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agentRub!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  warehousePortUsd!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fobUsd!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  portMskRub!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  extraLogisticsRub!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  categoryIds!: string[];
}

/** PATCH: все поля опциональны (в т.ч. только setAsPrimary). */
export class PatchPricingProfileAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  setAsPrimary?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['40', '20'])
  containerType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  containerMaxWeightKg?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  containerMaxVolumeM3?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cnyRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  usdRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  eurRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transferCommissionPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsAdValoremPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsWeightPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vatPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agentRub?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  warehousePortUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fobUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  portMskRub?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  extraLogisticsRub?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  categoryIds?: string[];
}

export class PricingPreviewAdminDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categoryIds!: string[];

  @Type(() => Number)
  @IsNumber()
  costPriceCny!: number;

  @Type(() => Number)
  @IsNumber()
  weightKg!: number;

  @Type(() => Number)
  @IsNumber()
  volumeM3!: number;
}

export class PricingReversePreviewAdminDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  retailRub!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  weightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  volumeM3?: number;
}

export class PricingForwardDefaultPreviewAdminDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPriceCny!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  weightKg!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  volumeM3!: number;
}

export class PricingForwardDefaultPreviewLineAdminDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPriceCny!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  weightKg!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  volumeM3!: number;
}

export class PricingForwardDefaultPreviewBatchAdminDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingForwardDefaultPreviewLineAdminDto)
  lines!: PricingForwardDefaultPreviewLineAdminDto[];
}
