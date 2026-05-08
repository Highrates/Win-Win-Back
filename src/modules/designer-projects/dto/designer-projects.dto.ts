import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class DesignerProjectRoomInputDto {
  @IsString()
  key!: string;

  @IsString()
  label!: string;

  @IsString()
  roomType!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class DesignerProjectLineInputDto {
  @IsString()
  roomKey!: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  productVariantId?: string | null;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  snapshot?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CreateDesignerProjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DesignerProjectRoomInputDto)
  rooms?: DesignerProjectRoomInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DesignerProjectLineInputDto)
  lines?: DesignerProjectLineInputDto[];
}

export class UpdateDesignerProjectDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DesignerProjectRoomInputDto)
  rooms?: DesignerProjectRoomInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DesignerProjectLineInputDto)
  lines?: DesignerProjectLineInputDto[];
}

export class DesignerProjectsAdminQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
