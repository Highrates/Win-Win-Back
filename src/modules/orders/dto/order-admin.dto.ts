import { OrderStatus } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusAdminDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsObject()
  documentUrls?: Record<string, string>;
}

export class UpdateOrderAdminNotesDto {
  @IsString()
  @MaxLength(20000)
  adminNotes!: string;
}
