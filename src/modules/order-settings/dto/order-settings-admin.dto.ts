import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/** PATCH `settings/admin/orders` — только глобальный лимит КП. Бонусы дизайнера — `settings/admin/designer-bonus-profiles`. */
export class UpdateOrderSettingsAdminDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  kpMaxLineDiscountPercent!: number;
}
