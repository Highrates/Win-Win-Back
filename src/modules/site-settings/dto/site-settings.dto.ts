import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSiteSettingsAdminDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  heroImageUrls?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  designerServiceOptions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  caseRoomTypeOptions?: string[];

  @IsOptional()
  @IsObject()
  orderStatusLabels?: Record<string, string>;
}

