import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateOrderSettingsAdminDto {
  /** Процент с суммы «цена на сайте» строк своего заказа, 0–100 (0 — отключено). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  designerOwnCatalogBonusPercent!: number;

  /** Порог суммы каталога по заказу (₽), ниже — бонус 0; сохраняется округлением вниз. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  designerOwnMinimumCatalogSiteTotalRub!: number;

  /** Лимит скидки на строку КП, % от 0 до 100 включительно. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  kpMaxLineDiscountPercent!: number;
}
