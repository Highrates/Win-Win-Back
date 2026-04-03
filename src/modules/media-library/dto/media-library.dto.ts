import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMediaFolderDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class UpdateMediaObjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  originalName?: string;

  @IsOptional()
  @IsString()
  altText?: string | null;

  @IsOptional()
  @IsString()
  folderId?: string | null;
}
