import { ArrayMaxSize, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSiteSettingsAdminDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  heroImageUrls?: string[];
}

