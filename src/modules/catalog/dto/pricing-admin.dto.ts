import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertPricingProfileAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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
