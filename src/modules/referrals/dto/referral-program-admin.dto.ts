import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateReferralProgramAdminDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  level1Percent!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  level2Percent!: number;

  /** Минимальная сумма позиций заказа по полю «цена на сайте» (₽), с которой считается бонус */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumOrderSiteTotalRub!: number;
}
