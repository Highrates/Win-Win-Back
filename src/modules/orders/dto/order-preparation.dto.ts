import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class AddOrderPreparationLineDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  productVariantId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(999999)
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsObject()
  snapshot?: Record<string, unknown>;
}

export class PatchOrderPreparationDto {
  @IsOptional()
  @IsString()
  customerName?: string | null;

  @IsOptional()
  @IsString()
  deliveryAddress?: string | null;

  @IsOptional()
  @IsString()
  comment?: string | null;
}

export class PatchOrderPreparationLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999)
  quantity!: number;
}

/** Отправка черновика: опционально только выбранные строки (остальные удаляются из заказа до смены статуса). */
export class SubmitPreparationDraftDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lineIds?: string[];
}
