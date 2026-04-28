import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  services?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  aboutHtml?: string;

  @IsOptional()
  @IsString()
  @IsIn(['4:3', '16:9'])
  coverLayout?: '4:3' | '16:9';

  /** Явные URL (после загрузок через multipart) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coverImageUrls?: string[];

  @IsOptional()
  avatarUrl?: string | null;
}

/** Видимость карточки партнёра в каталоге дизайнеров на сайте (только одобренные Win-Win). */
export class DesignerSiteVisibilityDto {
  @IsBoolean()
  visible!: boolean;
}
