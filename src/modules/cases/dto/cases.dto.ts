import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Общие поля записи Case (дизайнерский кейс и бренд-проект админа).
 * Create/Update наследуют одну форму; `isPublished` опционален (черновик бренд-кейсов).
 */
export class CaseWriteFieldsDto {
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
  @IsIn(['4:3', '16:9', '9:16'])
  coverLayout?: '4:3' | '16:9' | '9:16' | null;

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

  /** Бренд-админ: черновик не показывается на публичной витрине. Дизайнерские кейсы всегда published. */
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean | null;
}

export class CreateMyCaseDto extends CaseWriteFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class UpdateMyCaseDto extends CaseWriteFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;
}

/** Админ: задать «накрутку» лайков кейса (отдельно от реальных CaseLike). */
export class AdminPatchCaseLikesBoostDto {
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  likesAdminBoost!: number;
}

/** Массовое удаление своих кейсов. */
export class BulkDeleteMyCasesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  ids!: string[];
}
