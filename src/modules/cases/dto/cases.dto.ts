import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMyCaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  budget?: string | null;

  @IsOptional()
  @IsString()
  descriptionHtml?: string | null;

  @IsOptional()
  @IsIn(['4:3', '16:9'])
  coverLayout?: '4:3' | '16:9' | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  coverImageUrls?: string[] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  roomTypes?: string[] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  productIds?: string[] | null;
}

export class UpdateMyCaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  shortDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  budget?: string | null;

  @IsOptional()
  @IsString()
  descriptionHtml?: string | null;

  @IsOptional()
  @IsIn(['4:3', '16:9'])
  coverLayout?: '4:3' | '16:9' | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  coverImageUrls?: string[] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  roomTypes?: string[] | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  productIds?: string[] | null;
}

