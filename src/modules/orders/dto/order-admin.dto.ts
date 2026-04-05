import { OrderStatus } from '@prisma/client';
import { IsEnum, IsObject, IsOptional } from 'class-validator';

export class UpdateOrderStatusAdminDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsObject()
  documentUrls?: Record<string, string>;
}
