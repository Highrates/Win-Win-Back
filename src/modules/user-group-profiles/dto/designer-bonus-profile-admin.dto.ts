import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertDesignerBonusProfileAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  designerOwnCatalogBonusPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  designerOwnMinimumCatalogSiteTotalRub?: number;

  /** Назначить этот профиль основным (для пользователей без группы). */
  @IsOptional()
  @IsBoolean()
  setAsPrimary?: boolean;
}
